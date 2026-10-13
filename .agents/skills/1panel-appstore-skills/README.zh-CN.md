# 1Panel Appstore Skills

[English](./README.md) | [简体中文](./README.zh-CN.md)

`1panel-appstore-skills` 是一个用于创建 1Panel 应用商店应用安装包的 Skill。

它面向已经支持 Docker 化部署的应用，可以根据官方仓库、官方文档、Docker 镜像、`docker-compose.yml`，或已经整理好的中间 spec，生成符合 1Panel 应用商店应用格式的安装包。

## 何时使用

适合在以下场景使用：

- 将一个 Docker 化应用封装为 1Panel 应用商店应用包。
- 将官方仓库或官方文档中的 Docker / Docker Compose 安装方式转换为 1Panel 应用包。
- 将现有 `docker-compose.yml` 整理为 1Panel 应用商店目录结构。
- 基于已准备好的 app spec 生成 `data.yml`、`docker-compose.yml`、README 和数据目录。

不适合在以下场景使用：

- 应用没有可靠的 Docker 化安装方式。
- 需要凭空设计应用部署架构、镜像、端口、数据目录或环境变量。
- 需要发布到远程应用商店仓库；本 Skill 只负责生成应用包内容。

## 支持的输入

- 应用名称或官方仓库地址。
- Docker 镜像地址和必要的部署参数。
- 官方 `docker-compose.yml` / `compose.yml` 文件。
- 符合 `references/appspec.md` 的中间 JSON spec。

## 输出内容

生成结果是一个 1Panel 应用商店应用包目录，默认形态为：

```text
apps/<app-key>/
  logo.png
  README.md
  README_en.md
  data.yml
  <version>/
    data.yml
    docker-compose.yml
    data/
    scripts/        # 可选：需要处理持久化目录权限时生成 init.sh
```

其中会根据输入和官方来源处理：

- 应用基础信息、版本、类型、标签、网站、文档和仓库地址。
- 主服务和依赖服务的镜像、端口、环境变量、数据卷和启动依赖。
- 1Panel 需要的 `data.yml` 字段、表单项和多语言描述。
- 中文 README；当官方应用或文档支持英文时生成英文 README。
- 持久化目录权限初始化脚本；仅在官方来源能证明需要时生成。

## 项目结构

```text
1panel-appstore-skills/
  README.md
  README.zh-CN.md
  SKILL.md
  assets/
  references/
  scripts/
```

核心文件说明：

- `SKILL.md`：定义 Skill 的触发场景、工作流程和封装规则。
- `assets/sample-appspec.json`：中间 spec 示例，可用于了解生成流程。
- `references/appstore-format.md`：1Panel 应用包目录和字段规则。
- `references/source-policy.md`：应用源码、官方文档和 Docker 安装方式的来源规则。
- `scripts/generate_app_package.py`：根据中间 spec 生成 1Panel 应用包。

## 信息来源要求

应用包中的 Docker 安装方式必须来自应用官方仓库或官方文档。

如果提供了仓库地址，优先使用该仓库作为主线来源。只有在没有仓库地址时，才去 GitHub、Gitee、GitLab 等主流开源代码仓库中查找，并确认找到的是官方仓库。

可参考仓库内的 `README`、`docs`、`docker-compose.yml`、`compose.yml`、`Dockerfile`、`.env.example`、部署文档，以及官方文档站点中明确给出的 Docker / Docker Compose 安装说明。涉及容器运行用户、UID/GID、数据目录权限要求时，也需要来自官方 `Dockerfile`、Compose 文件或镜像文档。

当官方来源没有 Docker 安装方式时，需要先补充可靠的容器化安装信息，再生成应用包。

优先使用官方容器镜像。官方没有公开可用镜像，或官方只提供源码构建方式时，可以在用户明确接受后使用第三方镜像，并记录第三方镜像来源。

如果生成 `init.sh`，脚本内容也需要有官方来源依据。当前最常见用途是处理持久化目录权限；官方文档明确需要其他安装前处理时，也可以写入对应命令。没有初始化动作时，应用包中不包含 `scripts/` 目录。

## 使用示例

```text
帮我把 https://github.com/example/myapp 封装成 1Panel 应用商店应用。
```

```text
帮我把 OpenClaw 封装成 1Panel 应用商店应用。
```

```text
帮我把 ghcr.io/example/myapp:1.0.0 封装成 1Panel 应用商店应用。
对外端口 8080，容器端口 3000。
```

```text
使用 1panel-appstore-skills，把当前目录的 docker-compose.yml 转成 1Panel 应用商店应用包。
```

## 生成命令

如果已经准备好中间 spec，可以直接运行脚本生成：

```bash
python3 scripts/generate_app_package.py \
  --spec assets/sample-appspec.json \
  --output apps
```

生成后会得到应用包目录：

```text
apps/<app-key>
```

## 本地测试

把生成的应用目录放到：

```text
/opt/1panel/resource/apps/local/<app-key>
```

然后在 1Panel 应用商店中刷新本地应用列表，测试安装、启动、停止、重启和卸载。
