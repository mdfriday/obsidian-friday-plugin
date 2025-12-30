# License 激活

主用户提供 License 激活功能，以方便用户使用 Sync 和 Publish 服务。


## 使用场景

### 1. 用户填入 License ，点击激活，根据规则生成用户名和密码，进行登录。

用户可以在 Obsidian Friday plugin 的 settings 页面中输入 License Key 进行激活。

这个设置会放在整个设置页面的最顶部，方便用户第一时间看到并进行激活。

左侧是一个输入框，用户可以输入 License Key。 右侧是一个激活按钮，用户点击后会发送请求进行激活。

License Key 格式示例：
License Key: MDF-YEZ8-5ZBL-C4U6
Email:       yez8-5zbl-c4u6@mdfriday.com
Password:    eWV6OC01emJsLWM0dTY=

对应的用户账号是由以下规则生成的：

// licenseKeyToEmail 将 License Key 转换为邮箱
// 规则：去掉 "MDF-" 前缀，转小写，加上 @mdfriday.com
func (cmd *licenseCmd) licenseKeyToEmail(licenseKey string) string {
key := strings.ToLower(strings.TrimPrefix(licenseKey, "MDF-"))
return fmt.Sprintf("%s@mdfriday.com", key)
}

// licenseKeyToPassword 将 License Key 转换为密码
// 规则：去掉 "MDF-" 前缀，转小写，base64 编码
func (cmd *licenseCmd) licenseKeyToPassword(licenseKey string) string {
key := strings.ToLower(strings.TrimPrefix(licenseKey, "MDF-"))
return base64.StdEncoding.EncodeToString([]byte(key))
}

所以，我们可以通过 License Key 直接计算出对应的邮箱和密码，进行登录。

登录的 API 已经有了，在 user.ts 文件里，我们只需要直接调用登录 API 即可，从实现中可以看到，我们需要先将 email 和 password 设置到 plugin settings 里，然后调用 login 方法。

	async login() {
		this.name = this.plugin.settings.username
		this.password = this.plugin.settings.password

登录成功后，我们会拿到一个 token，接下来我们就可以用这个 token 去调用激活 License 的 API 了。

### 2. 成功登陆后，正式对 License 进行激活。

```shell
curl -X POST http://127.0.0.1:1314/api/license/activate \
-H "Authorization: Bearer YOUR_TOKEN" \
-F "license_key=MDF-STARTER-TEST-001" \
-F "device_id=device-001" \
-F "device_name=MacBook Pro" \
-F "device_type=desktop"
```

我们需要在 hugoverse.ts 里添加一个 activateLicense 方法，调用上述 API 即可。

其中，device_id 需要是一个本机唯一标识，下一次再生成的时候还是要和第一次生成的一样，否则会被认为是不同设备。

在 Obsidian 插件中，首次通过 Node.js 采集稳定的硬件特征生成设备指纹，并将其持久化存储于 IndexedDB，后续启动直接读取该值，从而保证同一台机器的设备标识在跨会话场景下保持一致。

会得到如下结果：

```json
{
	"data": [
		{
			"activated": true,
			"firstTimeActivated": true,
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

这样，我们就完成了 License 的激活。
接下来，需要更新 Obsidian Friday plugin 的 settings 界面，显示当前 License 的状态信息。
这时候原来的输入框和激活按钮应该隐藏起来。出现新的信息如下：

- 显示当前 License 的状态信息，每条信息都是单独一行，例如：
  - License Key: MDF-SZ6F-DZL7-3RKG， 右边一个绿色对号，表示已激活成功。
  - Plan: starter - 这个 starter 样式是彩色渐变背景的标签样式
  - Expires At: 2025-12-31
  - Max Devices: 3
  - Max IPs: 3
  - Publish Enabled: true
  - Sync Enabled: true

Sync 栏现在已经实现，但要参照发布方式栏的样式，所有 sync 相关的配置都是和 Netlify 设置类似的样式。
默认帮且用户配置好 sync 相关的配置项，例如 db_endpoint, db_name, username - email, db_password。 
Enable Encryption 选项默认打开，表示启用加密传输。并提示用户输入加密密码。右侧有一个眼睛图标，点击可以显示/隐藏密码内容。

通过 firstTimeActivated 可以判断，用户是否是第一次激活 License 。
如果是第一次激活，则在Enable CouchDB Sync 选项下方，显示新的一行，左边是提示文件，告诉用户识到到这是第一次激活，右边提供一个按钮，用于同步本地数据到云端 CouchDB 数据库。

如果不是第一次激活，则显示 Fetch From Cloud 按钮，用户点击后，可以从云端 CouchDB 数据库拉取数据到本地。

上面设置里用到的信息都要存在 plugin settings 里，方便下次启动时读取使用。
firstTimeActivated 不用存储。
user_dir 也存储在 settings 里，方便后续使用。
