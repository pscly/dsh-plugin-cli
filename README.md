# dsh-plugin-cli（命令：`dsh-cli`）

DeepSeek Harness 插件的**脚手架 + 校验**工具。

> 非官方，也**不是** `dsh` 命令——那个随 DeepSeek Harness 一起发布。这个包只面向写插件的人。

## 为什么需要

写一个 DSH 插件最容易卡住的不是业务逻辑，是那些**不报错但就是不生效**的地方：

- `cordis.patch.yml` 里的 `name` 写成了插件 id 而不是**装进去的完整包名** → 启动时 `ERR_MODULE_NOT_FOUND`
- `name` 以 `@` 开头没加引号 → YAML 把它当指令
- 声明了 `dsh.client` 却没导出 `./client` → 界面静默不出现
- `exports` 指向的文件不存在

`dsh-cli check` 把这些一次列出来。`dsh-cli create` 则直接给你一个**能跑起来**的最小包。

## 安装

```sh
npx dsh-plugin-cli --help
# 或
npm i -g dsh-plugin-cli
```

零依赖，Node 18 以上。

## 创建

```sh
dsh-cli create my-plugin
```

生成：

```
my-plugin/
├─ package.json        带 dsh.bundle.patch / dsh.client / exports
├─ cordis.patch.yml    插进 profile 组合的那一行
├─ lib/index.js        Host 入口（name / inject / apply）
├─ lib/client.js       浏览器入口（注册设置页 section）
└─ README.md
```

装上去：

```sh
dsh plugin --profile web add ./my-plugin
```

可选参数：`--name <包名>`（默认取目录名）、`--id <插件id>`、`--force`（目录非空时覆盖）。

## 校验

```sh
dsh-cli check          # 当前目录
dsh-cli check ./my-plugin
```

输出示例：

```
检查 ./my-plugin
  my-plugin@0.1.0
  · 声明兼容 DSH >=0.2.1-rc.2 <0.2.3

✓ 没有发现问题
```

发现问题时：

```
✗ ./cordis.patch.yml 里的 name (other-name) 与包名 my-plugin 不一致，装到 profile 后会 ERR_MODULE_NOT_FOUND

1 个问题。
```

## 它检查的东西

| 检查 | 触发的问题 |
|---|---|
| `package.json` 可解析 | 手工编辑出错 |
| `dsh.bundle.patch` 存在 | DSH 不把它当 bundle 安装 |
| patch 里的 `name` 等于包名 | `ERR_MODULE_NOT_FOUND` |
| patch 里 `@` 开头的 `name` 有引号 | YAML 解析失败 |
| `exports["."]` 指向的文件存在 | 插件加载不出来 |
| 声明 `dsh.client` 时有 `./client` | 界面不出现 |

## 参考

- 上游：https://github.com/deepseek-ai/deepseek-harness
- 插件开发：https://github.com/anywhere-labs/dsh-desktop/blob/master/docs/plugin-development.md

## 许可证

MIT

## 关于包名

命令叫 `dsh-cli`，但 npm 上的包名是 `dsh-plugin-cli`：npm 会把连字符抹掉做重名判断，`dsh-cli` 与 2022 年就存在的 `dshcli`（另一个脚手架工具）归一化后相同，无法注册。安装后两个命令都可用（`dsh-cli` 与 `dsh-plugin-cli`）。
