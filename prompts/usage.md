# 显示总的用量

目前我们在 settings 里显示的用量是设备的用量： 

设备，下面显示的 已注册设备数， 右边显示的是用量： 1/3

我们现在要将这一行改成显示总的硬盘空间使用量，右侧显示的是进度条，显示已使用的空间和总空间，并带上数值。

后端现在实现了一个接口，用来获取所有的用量：

```bash
curl -X GET "http://127.0.0.1:1314/api/license/usage?key=MDF-LW2Y-WPSL-GDRJ" \
-H "Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhdWQiOm51bGwsImV4cCI6IjIwMjYtMDEtMzBUMDk6MTk6NTUuNDEwOTgrMDg6MDAiLCJpYXQiOm51bGwsImlzcyI6bnVsbCwianRpIjpudWxsLCJuYmYiOm51bGwsInN1YiI6bnVsbCwidXNlciI6Imx3Mnktd3BzbC1nZHJqQG1kZnJpZGF5LmNvbSJ9.dxYYdbXUPkDPCKfq-kBlwQfhN0kRFUWaFE2c4swSy4E"
```

```json
{
  "data": [
    {
      "devices": {
        "count": 1,
        "devices": [
          {
            "access_count": 1,
            "device_id": "07b01e5863e18ef3509b495cf9e163024062a8762be89f2f3cb4b35741c9f7ec",
            "device_name": "Obsidian on macOS",
            "device_type": "desktop",
            "first_seen_at": 1767077775108,
            "last_seen_at": 1767077775108,
            "status": "active"
          }
        ]
      },
      "disks": {
        "couchdb_disk_usage": "0.16",
        "publish_disk_usage": "6.00",
        "total_disk_usage": "6.16",
        "unit": "MB"
      },
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
      "ips": {
        "count": 1,
        "ips": [
          {
            "access_count": 1,
            "city": "",
            "country": "",
            "first_seen_at": 1767077775108,
            "ip_address": "127.0.0.1",
            "last_seen_at": 1767077775108,
            "region": "",
            "status": "active"
          }
        ]
      },
      "license_key": "MDF-LW2Y-WPSL-GDRJ",
      "plan": "starter"
    }
  ]
}
```

每次 obsidian 启动时，都会调用这个接口，获取最新的用量信息，然后在设置界面显示出来。
我们从 disks 里可以获取 total_disk_usage 字段，单位是 MB。

features 里有 max_storage 字段，单位也是 MB。

这两个字段可以用来计算进度条的百分比。
