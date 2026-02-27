# Database Reset Detection Mechanism

## Overview

Friday Sync uses a **dual-layer protection mechanism** to detect remote database resets and prevent data corruption from stale device uploads.

---

## Design Philosophy

Unlike standard livesync which uses MILESTONE document with `locked` flags, Friday implements a **backend-controlled database reset** where:

1. **Backend deletes old database**
2. **Backend creates new database with same configuration**
3. **New PBKDF2 salt is generated** (the key indicator)

---

## Dual-Layer Protection

### Layer 1: SALT Detection (Primary)

**Location**: `LiveSyncAbstractReplicator.checkSaltConsistency()`  
**Trigger**: Every sync operation via `openOneShotReplication()`

**How it works**:
```typescript
// 1. Get remote salt (force refresh)
const remoteSalt = await this.getReplicationPBKDF2Salt(setting, true);

// 2. Compare with locally stored salt
const storedSalt = await saltStore.get(saltKey);

// 3. If mismatch → Block sync
if (storedSalt !== remoteSaltBase64) {
    this.remoteLockedAndDeviceNotAccepted = true;
    this.remoteLocked = true;
    this.remoteCleaned = true;
    return { ok: false, needsFetch: true };
}
```

**Advantages**:
- ✅ Simple and reliable (single source of truth)
- ✅ Backend-controlled (no client-side MILESTONE management)
- ✅ Works with backend database recreation

---

### Layer 2: MILESTONE Locked Flag (Backup)

**Location**: `ensureDatabaseIsCompatible()` (from livesync core)  
**Trigger**: Connection check via `checkReplicationConnectivity()`

**How it works**:
```typescript
const ensure = await ensureDatabaseIsCompatible(db, setting, nodeid, ...);

if (ensure == "NODE_LOCKED" || ensure == "NODE_CLEANED") {
    this.remoteLockedAndDeviceNotAccepted = true;
    this.remoteLocked = true;
    return false;  // Block sync
}
```

**Why keep this?**:
- 🛡️ **Defense-in-depth**: Backup if salt check fails
- 🔧 **livesync compatibility**: Core code expects MILESTONE flags
- 🚀 **Future-proof**: Supports additional detection mechanisms

---

## Complete Flow

### When Device A Resets Remote Database

**Step 1**: User clicks "Upload to Cloud" on Device A

**Step 2**: `rebuildRemote()` executes:
```typescript
// Mark as locked (MILESTONE protection)
await replicator.markRemoteLocked(settings, true, true);

// Reset database (backend deletes & recreates with NEW SALT)
await replicator.tryResetRemoteDatabase(settings);
  ↓ ensurePBKDF2Salt(setting, true, false)  // Get new salt
  ↓ updateStoredSalt(setting)                // Store new salt locally

// Mark as locked again (ensure MILESTONE persists)
await replicator.markRemoteLocked(settings, true, true);

// Upload data
await replicator.replicateAllToServer(settings, true);  // x2
```

**Result**:
- ✅ Remote has new salt
- ✅ Device A knows new salt (stored locally)
- ✅ MILESTONE has `locked=true`, `cleaned=true`, `accepted_nodes=[Device A]`

---

### When Device B Tries to Sync

**Step 1**: Device B starts Obsidian

**Step 2**: Auto-sync triggered → `openOneShotReplication()`

**Step 3**: **SALT CHECK (Primary)**:
```typescript
const saltCheck = await checkSaltConsistency(setting);
// Remote salt: NEW_SALT_XXXXX
// Stored salt: OLD_SALT_YYYYY
// Result: MISMATCH! 

if (!saltCheck.ok) {
    // ❌ SYNC BLOCKED
    Logger("Remote database has been reset", LOG_LEVEL_NOTICE);
    this.syncStatus = "ERRORED";
    return false;
}
```

**Step 4**: **MILESTONE CHECK (Backup)**:
```typescript
const ensure = await ensureDatabaseIsCompatible(...);
// remoteMilestone.locked = true
// remoteMilestone.accepted_nodes = [Device A]  (Device B not in list)
// Result: "NODE_CLEANED"

if (ensure == "NODE_CLEANED") {
    // ❌ SYNC BLOCKED (redundant, already blocked by salt)
    this.remoteLockedAndDeviceNotAccepted = true;
    return false;
}
```

**Result**:
- ❌ Device B **cannot sync** (both layers blocked)
- 📢 User sees: "Remote database has been reset. Please go to Settings → 'Fetch from Server'"

---

### When Device B Recovers

**Step 1**: User clicks "Fetch from Server" on Device B

**Step 2**: `rebuildLocalFromRemote()` executes:

```typescript
// Phase 1: Suspend operations
storageEventManager.stopWatch();

// Phase 2: Reset local database
await localDatabase.resetDatabase();

// Phase 3: Verify database ready
// (no redundant initializeDatabase call - fixed!)

// Phase 4: Mark device as resolved
replicator.remoteLockedAndDeviceNotAccepted = false;  // Clear flags
replicator.remoteLocked = false;
replicator.remoteCleaned = false;
await replicator.markRemoteResolved(settings);  // Add to accepted_nodes
await replicator.updateStoredSalt(settings);     // Store NEW salt

// Phase 5-6: Download data (x2 for completeness)
await replicator.replicateAllFromServer(settings, true);

// Phase 6.5: Fetch missing chunks (if readChunksOnline=true)
if (settings.readChunksOnline && !settings.useOnlyLocalChunk) {
    await fetchAllMissingChunksFromRemote();
}

// Phase 7: Rebuild vault
await rebuildVaultFromDB();

// Phase 8: Resume operations
storageEventManager.startWatch();
```

**Result**:
- ✅ Device B has new salt
- ✅ Device B in `accepted_nodes`
- ✅ Device B can sync normally

---

## Key Implementation Details

### 1. Salt Update Timing

**Device A (Resetter)**:
- Updates salt **during reset** in `tryResetRemoteDatabase()`
- Called **before upload** to prevent self-blocking

**Device B (Fetcher)**:
- Updates salt **during fetch** in `rebuildLocalFromRemote()` Phase 4
- Called **before download** to accept new remote state

### 2. Flag Management

**Never manually reset flags during connectivity check**:
```typescript
// ❌ WRONG (was our initial fix attempt):
// Reset flags before check → defeats protection
this.remoteCleaned = false;
this.remoteLocked = false;
this.remoteLockedAndDeviceNotAccepted = false;

// ✅ CORRECT (livesync pattern):
// Reset at start, re-set based on actual remote state
// Flags are re-evaluated by ensureDatabaseIsCompatible()
```

### 3. Chunk Fetching Fix

**Problem**: When `readChunksOnline=true`, replication only downloads metadata (not chunks)

**Solution**: Phase 6.5 explicitly fetches missing chunks
```typescript
if (settings.readChunksOnline && !settings.useOnlyLocalChunk) {
    await fetchAllMissingChunksFromRemote();
}
```

---

## Testing Checklist

- [ ] **Device A**: Reset & upload → Salt changes, MILESTONE locked
- [ ] **Device B**: Open Obsidian → Auto-sync blocked by salt check
- [ ] **Device B**: Sync manually → Still blocked, shows error message
- [ ] **Device B**: Fetch from server → Success, new salt stored
- [ ] **Device B**: Normal sync → Works, chunks download correctly
- [ ] **Verify**: No "chunks missing" errors
- [ ] **Verify**: No stale data uploaded from Device B

---

## Comparison with livesync

| Aspect | livesync | Friday Sync |
|--------|----------|-------------|
| **Primary Detection** | MILESTONE locked flag | SALT comparison |
| **Database Reset** | Client calls `db.destroy()` | Backend recreates DB |
| **Salt Role** | Encryption only | Encryption + Reset detection |
| **MILESTONE Role** | Primary lock mechanism | Backup protection |
| **Device Registration** | `accepted_nodes` list | Salt storage + `accepted_nodes` |

---

## Advantages of Friday's Approach

1. **🔒 Backend Control**: Server controls database lifecycle
2. **🎯 Simple Detection**: Single salt comparison vs. complex MILESTONE logic
3. **🛡️ Defense-in-Depth**: Two independent protection layers
4. **📦 livesync Compatible**: Still works with core livesync code
5. **🚀 Scalable**: Backend can implement additional safety measures

---

## Related Files

- **Salt Check**: `src/sync/core/replication/LiveSyncAbstractReplicator.ts` (lines 137-181)
- **Reset Flow**: `src/sync/FridaySyncCore.ts` `rebuildRemote()` (lines 1152-1255)
- **Fetch Flow**: `src/sync/FridaySyncCore.ts` `rebuildLocalFromRemote()` (lines 1621-1848)
- **MILESTONE Check**: `src/sync/core/pouchdb/LiveSyncDBFunctions.ts` `ensureDatabaseIsCompatible()` (lines 172-194)
- **Connection Check**: `src/sync/core/replication/couchdb/LiveSyncReplicator.ts` `checkReplicationConnectivity()` (lines 1050-1159)

---

## Debugging

**Enable verbose logging**:
```typescript
Logger(`Salt mismatch detected! Stored: ${storedSalt}..., Remote: ${remoteSalt}...`, LOG_LEVEL_INFO);
Logger(`Database compatibility check passed, lock flags cleared`, LOG_LEVEL_VERBOSE);
```

**Check flags**:
```typescript
console.log({
    remoteLockedAndDeviceNotAccepted: replicator.remoteLockedAndDeviceNotAccepted,
    remoteLocked: replicator.remoteLocked,
    remoteCleaned: replicator.remoteCleaned
});
```

**Verify salt storage**:
```typescript
const saltStore = database.openSimpleStore<string>("friday-sync-salt");
const storedSalt = await saltStore.get(`known_salt_${dbName}`);
console.log(`Stored salt: ${storedSalt}`);
```

---

## Version History

- **2024-02**: Initial salt-based detection implementation
- **2024-02**: Added MILESTONE backup protection
- **2024-02**: Fixed chunk fetching for `readChunksOnline` mode
- **2024-02**: Fixed flag reset timing in connectivity check
