# 需求

引入 Base Path，这样用户可以指定路径，按需将构建好的站点文件上传到指定的服务器目录下。也可以方便在本地预览，只需一次构建，就能满足预览，和发布的不同场景。

## 需要修改的地方

1. 在 Site.svelte 视图里， Site Name 下面，添加 高级配置 一栏，其中包含 Site Path 项， 可以通过输入框输入指定路径，默认是根目录，也就是 “/”。 高级配置栏默认收缩起来的，只有一个下拉展开按钮，点击时会展开，并且背景是深色，有一种打开了，看到里面深层的视觉效果。
2. 目前的 http server 是在 Site.svelte 视图挂载时启动的，是固定指向 preview 目录的。支持 Site Path 后，我们需要预览构建成功后，动态指向新的目录了。 新目录的规则是，当用户点击 Generate Preview 按钮时，我们现在会随机生成一个目录，并创建好 public 目录，以及 content 目录，其中 content 目录是用 Symbolink 链向真正构建内容的。 有了指定 Site Path功能后，如果是默认的根目录，则我们启动 http server 时，直接指向 public 目录作为根目录；如果不是默认值， 我们需要在 public 目录同级的目录创建好相应的层级结构，例如 site path 的值是 /path/sub ， 我们就需要在 public 同级目录创建 path, 并将 sub 目录用 symbolick 指向 public 目录， 这样 http server 就可以指向当前构建目录作为根目录，通过访问 localhost:8090/path/sub 来进行预览了。 
3. 因为可以配置 Site Path了，那么在创建配置文件时 createConfigFile 时，其中的 baseURL 就可以用 Site Path 的值进行填充了
4. http server 在新的构建成功后，要先停止，因为之前是指向别的目录的，现在要动态指向新的目录了。