# Prompt：实现 Obsidian Friday Plugin 的 License 激活与 Sync 无感知体验

你是一个 **资深 Obsidian 插件工程师**，正在为 **Friday（MDFriday）插件**实现一套 **License 激活 + 自动登录 + 自动同步配置** 的完整功能。  
目标是：**技术实现完整，但用户体验极简、无感知，风格完全贴合 Obsidian 原生 Settings。**

---

## 一、总体目标（必须遵守）

1. 用户 **只输入一次 License Key**
2. 不暴露任何技术实现细节（账号、数据库、endpoint 等）
3. 激活成功后：
   - 自动完成登录
   - 自动完成 License 激活
   - 自动配置 Sync
4. Settings 页面遵循 **Apple / Obsidian 式设计理念**
   - 状态优先
   - 单一主要操作
   - 渐进式信息披露

---

## 二、License 激活整体流程（实现逻辑）

### Step 1：License Key → 账号凭证

License Key 示例：

```

MDF-YEZ8-5ZBL-C4U6

````

生成规则（必须完全一致）：

```ts
function licenseKeyToEmail(licenseKey: string): string {
  const key = licenseKey.replace(/^MDF-/, "").toLowerCase();
  return `${key}@mdfriday.com`;
}

function licenseKeyToPassword(licenseKey: string): string {
  const key = licenseKey.replace(/^MDF-/, "").toLowerCase();
  return btoa(key);
}
````

---

### Step 2：自动登录（已存在 API）

1. 将生成的 `email` 和 `password` 写入 plugin settings：

	* `settings.username`
	* `settings.password`
2. 调用 `user.ts` 中已有的 `login()` 方法
3. 登录成功后获取 `token`
4. 将 `token` 持久化存储在 plugin settings 中

---

### Step 3：激活 License（hugoverse.ts）

实现 `activateLicense()` 方法，请求如下：

```http
POST /api/license/activate
Authorization: Bearer <token>

FormData:
- license_key
- device_id
- device_name
- device_type
```

#### device_id 生成规则（必须稳定）

* 首次运行：

	* 使用 Node.js 收集稳定硬件特征
	* 生成设备指纹
	* 存储于 IndexedDB
* 后续启动：

	* 直接从 IndexedDB 读取
* 确保 **同一设备跨会话 device_id 不变**

---

### Step 4：处理激活返回结果

返回数据结构示例（已知）：

```json
{
	"data": [
		{
			"activated": true,
			"first_time": true,
			"expires_at": 1798600713142,
			"features": {
				"max_devices": 3,
				"max_ips": 3,
				"sync_enabled": true,
				"sync_quota": 500,
				"publish_enabled": true,
				"max_sites": 3,
				"max_storage": 1024,
				"custom_domain": false,
				"validity_days": 365
			},
			"license_key": "MDF-SZ6F-DZL7-3RKG",
			"plan": "starter",
			"success": true,
			"sync": {
				"db_endpoint": "http://localhost:5984/userdb-ce5a84463fb4e209",
				"db_name": "userdb-ce5a84463fb4e209",
				"db_password": "c3o2Zi1kemw3LTNya2c=",
				"email": "sz6f-dzl7-3rkg@mdfriday.com",
				"status": "active"
			},
			"user": {
				"email": "sz6f-dzl7-3rkg@mdfriday.com",
				"user_dir": "ce5a84463fb4e209"
			}
		}
	]
}
```

---

## 三、Plugin Settings 持久化设计（重要）

### 必须存储（但不暴露给用户）

```ts
settings.license = {
  key,
  plan,
  expiresAt,
  features,
};

settings.sync = {
  enabled: true,
  endpoint,
  dbName,
  email,
  dbPassword,
};

settings.user = {
  userDir,
};

settings.token = token;
```

### 不需要存储

* `first_time`（只用于当次 UI 判断）

---

## 四、Settings UI 设计（严格遵循）

### 1️⃣ License 区块（始终在最顶部）

#### 未激活状态

```
License
------------------------------------------------
License Key   [ MDF-XXXX-XXXX-XXXX           ] [ Activate ]
```

* 唯一可操作按钮：`Activate`

---

#### 激活中状态

按钮上的文案变更为：

```
Activating…
```

* 禁用输入框
* 禁用按钮，防止重复点击，正在运行中，颜色不变

---

#### 已激活状态（默认展示）

```
✔ License Active

Plan         Starter
Valid Until  Dec 31, 2025
```

---

#### 可选展开（Details）

```
License Key   MDF-••••-••••-3RKG
Devices       1 / 3
Sync          Enabled
Publish       Enabled
```

---

### 2️⃣ Sync 区块（自动启用）

#### 默认状态

```
✔ Sync is enabled

Your data is securely synced across devices.
```

默认启用 sync on start, sync on save, 以及现有的 liveSync 模式。
不需要修改任何 sync 现在的功能实现，只需要调整 UI 即可。

---

#### 首次激活（first_time === true）

```
This is your first time using sync.
[ Upload local data to cloud ]
```

按钮行为：

* 将本地数据同步至云端数据库

---

#### 非首次激活

```
Data is available in the cloud.
[ Download data from cloud ]
```

按钮行为：

* 从云端拉取数据到本地

---

### 3️⃣ Security 区块

```
✔ End-to-end encryption is enabled
```

#### 展开后：

```
Encryption Password   [ ••••••••• ] 👁
```

规则：

* 默认开启
* 必填 - 第一次激活时自动生成密码，并存储于 settings，可查看
* 支持显示 / 隐藏

---

## 五、UI 设计原则（必须遵守）

1. 不显示以下内容：

	* CouchDB
	* Endpoint
	* 数据库名
	* 自动生成账号
2. 所有区块使用 Obsidian 原生 Setting 样式
3. 一个区块内 **最多一个主要操作按钮**
4. 所有文案使用「状态 + 行为」表达方式

---

## 六、最终用户体验验证（必须满足）

* 用户只输入一次 License Key
* 不需要理解任何技术概念
* Sync 在激活后即可使用
* Settings 页面始终简洁、稳定、可预期

---

## 七、输出要求（你生成的代码必须包含）

1. License 激活完整逻辑
2. Settings 持久化
3. Settings UI 状态切换
4. 稳定 device_id 实现
5. 不暴露技术配置到 UI

请根据以上规范，直接生成 **Obsidian Friday Plugin 的 TypeScript 实现代码**，包括：

* Settings 渲染
* License 激活逻辑
* Sync 状态处理

不要输出解释性文字，只输出代码。

