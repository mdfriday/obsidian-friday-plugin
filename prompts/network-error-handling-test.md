# 网络错误处理功能 - 手动测试指南

## 概述

本文档提供网络错误处理功能的手动测试场景和操作步骤，用于验证以下模块的正确性：

| 模块 | 文件路径 | 功能 |
|------|----------|------|
| NetworkManager | `src/sync/core/managers/NetworkManager.ts` | 网络状态管理 |
| FridayNetworkEvents | `src/sync/features/NetworkEvents/index.ts` | 网络事件监听 |
| FridayConnectionFailureHandler | `src/sync/features/ConnectionFailure/index.ts` | 连接失败处理 |
| FridayConnectionMonitor | `src/sync/features/ConnectionMonitor/index.ts` | 连接健康监控 |
| FridayOfflineTracker | `src/sync/features/OfflineTracker/index.ts` | 离线变更跟踪 |

---

## 测试前准备

### 环境准备
1. 准备两台设备（或同一台设备的两个 Obsidian 实例）
2. 确保 Friday 插件已正确配置并能正常同步
3. 打开浏览器开发者工具（Ctrl+Shift+I / Cmd+Opt+I），切换到 Console 标签页观察日志
4. 在 Obsidian 中打开 Friday 同步状态显示（右上角状态栏）

### 调试技巧

#### 控制台过滤关键词
```
Network status
Network recovery
Scheduling reconnect
offline
Connection
ERRORED
Salt
```

#### 重要日志级别
- `LOG_LEVEL_INFO`: 一般信息（控制台可见）
- `LOG_LEVEL_NOTICE`: 用户可见通知（会弹出 Notice）
- `LOG_LEVEL_VERBOSE`: 详细调试信息（可能需要启用 Verbose 模式）

---

## 测试场景

### 场景 1：基本网络断开/恢复测试

**目的**：验证 `FridayNetworkEvents` 的 online/offline 事件处理

**测试模块**：FridayNetworkEvents, NetworkManager

#### 操作步骤
1. 启动 Obsidian，确保同步正常运行（状态显示 "LIVE"）
2. **断开网络**：
   - Windows/Mac: 断开 WiFi 或拔掉网线
   - 或使用飞行模式
3. 观察：
   - [ ] 控制台应显示 `Network status changed: offline`
   - [ ] 状态应变为 "NOT_CONNECTED"
4. 在离线状态下**创建一个新笔记** `test-offline-1.md`
5. **恢复网络连接**
6. 观察：
   - [ ] 控制台应显示 `Network status changed: online`
   - [ ] 控制台应显示 `Network recovery detected`
   - [ ] 同步应自动恢复
   - [ ] 新笔记应自动同步到服务器

#### 预期结果
- 网络断开时能正确检测并更新状态
- 网络恢复时能自动重连并同步

---

### 场景 2：服务器不可达测试（模拟防火墙）

**目的**：验证 `FridayConnectionFailureHandler` 的连接失败处理

**测试模块**：FridayConnectionFailureHandler, FridayConnectionMonitor

#### 操作步骤
1. **方法 A - 修改 hosts 文件**：
   - 编辑 `/etc/hosts` (Mac/Linux) 或 `C:\Windows\System32\drivers\etc\hosts` (Windows)
   - 添加：`127.0.0.1 your-couchdb-server.com`（将服务器域名指向本地）
   
2. **方法 B - 使用错误的端口**：
   - 临时修改 Friday 设置中的服务器 URI，使用错误端口（如 :9999）

3. 启动或重启 Obsidian
4. 观察：
   - [ ] 控制台应显示连接失败相关日志
   - [ ] 应显示 Notice 通知："Cannot connect to sync server. Will retry when network is available."
   - [ ] 状态应显示 "NOT_CONNECTED" 或 "Connection failed, will retry"

5. 等待 10-30 秒，观察：
   - [ ] 控制台应显示 `Scheduling reconnect in Xms`
   - [ ] 应自动尝试重连

6. 恢复正确的服务器配置
7. 观察：
   - [ ] 重连成功后显示 "Reconnected and sync restarted"

#### 预期结果
- 服务器不可达时能正确检测（不仅仅依赖 navigator.onLine）
- 显示用户友好的通知
- 自动调度重连尝试

---

### 场景 3：长时间离线后恢复（8小时场景模拟）

**目的**：验证 `FridayOfflineTracker` 的离线变更跟踪

**测试模块**：FridayOfflineTracker, FridayNetworkEvents

#### 操作步骤
1. 确保同步正常运行
2. **断开网络**
3. 在离线状态下进行多项操作：
   - 创建文件：`offline-create-1.md`, `offline-create-2.md`
   - 修改现有文件：编辑某个已同步的文件
   - 删除文件：删除一个已同步的文件
4. 等待 1-2 分钟（模拟长时间离线）
5. **恢复网络连接**
6. 观察控制台和状态：
   - [ ] 应显示 `Came online with X pending changes`
   - [ ] 应显示 `Applying X offline changes...`
   - [ ] 所有离线操作的文件应同步到服务器

#### 验证步骤
- 在另一台设备上检查：
  - [ ] 新创建的文件是否出现
  - [ ] 修改的内容是否同步
  - [ ] 删除的文件是否被删除

#### 预期结果
- 离线期间的所有变更都被跟踪
- 网络恢复后自动应用所有离线变更

---

### 场景 4：窗口可见性变化测试

**目的**：验证 `FridayNetworkEvents` 的 visibilitychange 处理

**测试模块**：FridayNetworkEvents

#### 操作步骤
1. 确保同步正常运行
2. **最小化 Obsidian 窗口**或切换到其他应用
3. 等待 30 秒
4. **重新激活 Obsidian 窗口**
5. 观察控制台：
   - [ ] 应显示 `Window visible, checking for sync updates`
   - [ ] 如果之前有连接问题，应尝试重连

#### 预期结果
- 窗口重新可见时触发同步检查

---

### 场景 5：连接监控健康检查测试

**目的**：验证 `FridayConnectionMonitor` 的定期健康检查

**测试模块**：FridayConnectionMonitor

#### 操作步骤
1. 启动 Obsidian，同步正常运行
2. 打开控制台，过滤日志关键词：`health` 或 `reconnect`
3. 等待约 1-2 分钟
4. 如果连接正常，应不会有重连尝试
5. **模拟连接异常**：在同步过程中快速断开再连接网络
6. 观察：
   - [ ] 如果状态变为 "ERRORED" 或 "CLOSED"
   - [ ] 健康检查应检测到并调度重连
   - [ ] 控制台应显示 `Connection appears unhealthy, scheduling reconnect`

#### 预期结果
- 定期健康检查能发现连接问题
- 自动调度重连修复

---

### 场景 6：指数退避测试

**目的**：验证重连延迟的指数退避机制

**测试模块**：FridayConnectionMonitor, FridayConnectionFailureHandler

#### 操作步骤
1. 使用场景 2 的方法使服务器不可达
2. 启动 Obsidian
3. 观察控制台中的重连延迟：
   - 第 1 次失败后：延迟约 5-10 秒
   - 第 2 次失败后：延迟约 15-20 秒
   - 第 3 次失败后：延迟约 30-45 秒
   - 继续观察，延迟应逐渐增加但不超过 5 分钟

#### 预期结果
- 重连延迟随失败次数指数增长
- 最大延迟不超过 300 秒（5 分钟）

---

### 场景 7：认证失败测试

**目的**：验证认证错误的处理

**测试模块**：FridayConnectionFailureHandler

#### 操作步骤
1. 在 Friday 设置中输入**错误的密码**
2. 尝试同步或重启插件
3. 观察：
   - [ ] 应显示 Notice："Authentication failed. Please check your credentials in Settings."
   - [ ] 不应无限重试（认证失败应中止而非重试）

#### 预期结果
- 认证错误能正确识别并提示用户
- 不会无限重试浪费资源

---

### 场景 8：数据库重置检测测试

**目的**：验证 Salt 变化检测（数据库重置）

**测试模块**：Salt 检测机制（LiveSyncAbstractReplicator）

#### 操作步骤
1. 在设备 A 上正常同步
2. 在后端**重置远程数据库**（模拟数据库重建）
3. 在设备 A 上尝试同步
4. 观察：
   - [ ] 应检测到 Salt 变化
   - [ ] 应显示 Notice："Remote database has been reset. Please use 'Fetch from Server' in Settings to re-sync."
   - [ ] 状态应显示 "Database reset detected"

#### 恢复步骤
- 进入 Friday 设置
- 点击 "Fetch from Server" 重新同步

#### 预期结果
- 能正确检测数据库重置
- 提示用户采取正确的恢复操作

---

### 场景 9：通知冷却测试

**目的**：验证通知不会重复显示（30 秒冷却）

**测试模块**：FridayConnectionFailureHandler

#### 操作步骤
1. 使服务器不可达
2. 启动 Obsidian
3. 观察 Notice 通知
4. 记录第一次通知时间
5. 等待，观察是否在 30 秒内再次显示相同通知

#### 预期结果
- 相同类型的错误通知至少间隔 30 秒
- 避免用户被重复通知打扰

---

## 测试检查清单

| # | 场景 | 功能模块 | 通过 | 备注 |
|---|------|----------|:----:|------|
| 1 | 网络断开/恢复 | FridayNetworkEvents | ☐ | |
| 2 | 服务器不可达 | FridayConnectionFailureHandler | ☐ | |
| 3 | 长时间离线恢复 | FridayOfflineTracker | ☐ | |
| 4 | 窗口可见性变化 | FridayNetworkEvents | ☐ | |
| 5 | 健康检查 | FridayConnectionMonitor | ☐ | |
| 6 | 指数退避 | FridayConnectionMonitor | ☐ | |
| 7 | 认证失败 | FridayConnectionFailureHandler | ☐ | |
| 8 | 数据库重置检测 | Salt 检测机制 | ☐ | |
| 9 | 通知冷却 | FridayConnectionFailureHandler | ☐ | |

---

## 测试记录模板

### 测试日期：____年__月__日

### 测试环境
- 操作系统：
- Obsidian 版本：
- Friday 插件版本：
- 网络环境：

### 测试结果

| 场景 | 结果 | 问题描述 |
|------|:----:|----------|
| 场景 1 | ☐ 通过 / ☐ 失败 | |
| 场景 2 | ☐ 通过 / ☐ 失败 | |
| 场景 3 | ☐ 通过 / ☐ 失败 | |
| 场景 4 | ☐ 通过 / ☐ 失败 | |
| 场景 5 | ☐ 通过 / ☐ 失败 | |
| 场景 6 | ☐ 通过 / ☐ 失败 | |
| 场景 7 | ☐ 通过 / ☐ 失败 | |
| 场景 8 | ☐ 通过 / ☐ 失败 | |
| 场景 9 | ☐ 通过 / ☐ 失败 | |

### 发现的问题

1. 
2. 
3. 

### 改进建议

1. 
2. 
3. 

