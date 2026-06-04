# MiyaPrin Gesture Particles

一个面向手机 Google Chrome 的手势粒子交互网页 Demo。项目使用 HTML、CSS、JavaScript、Canvas 和 MediaPipe Hand Landmarker，部署到 HTTPS 后可以在手机浏览器中请求前置摄像头权限。

## 功能

- 页面打开后提示开启摄像头权限
- 优先请求手机前置摄像头
- 摄像头画面隐藏，只展示粒子互动和品牌名
- 手掌靠近时粒子柔和推开
- 食指移动时粒子产生轻微拖尾
- 拇指和食指捏合时粒子向捏合点聚拢
- 五指张开时粒子自然散开
- 没有检测到手时粒子恢复自然漂浮
- 不支持摄像头或权限失败时保留备用粒子动画
- 支持手机触控备用交互
- 根据设备和 FPS 自动降低或恢复粒子数量

## 项目结构

```text
miya-prin-gesture-particles/
├── index.html
├── package.json
├── vercel.json
├── netlify.toml
├── README.md
└── src/
    ├── app.js
    └── style.css
```

## 本地运行

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

浏览器打开终端显示的地址，例如：

```text
http://localhost:5173
```

本地 `localhost` 可以申请摄像头权限；如果用手机测试，建议直接部署到 HTTPS，再用手机打开公开网址。

## 部署到 Vercel

### 方法一：Git 仓库部署

1. 把项目推送到 GitHub、GitLab 或 Bitbucket。
2. 登录 Vercel。
3. 点击 `Add New Project`，选择该仓库。
4. Build Command 填：

```bash
npm run build
```

5. Output Directory 填：

```text
dist
```

6. 点击 Deploy。
7. 部署完成后会得到一个 `https://` 开头的网址。

### 方法二：Vercel CLI

```bash
npm install
npm run build
npx vercel
```

首次使用需要按提示登录 Vercel。预览确认无误后发布正式地址：

```bash
npx vercel --prod
```

## 部署到 Netlify

### 方法一：Git 仓库部署

1. 把项目推送到 GitHub、GitLab 或 Bitbucket。
2. 登录 Netlify。
3. 点击 `Add new site`，选择 `Import an existing project`。
4. Build command 填：

```bash
npm run build
```

5. Publish directory 填：

```text
dist
```

6. 点击 Deploy site。
7. 部署完成后会得到一个 `https://` 开头的网址。

### 方法二：Netlify CLI

```bash
npm install
npm run build
npx netlify deploy --dir=dist
```

确认预览没问题后发布正式地址：

```bash
npx netlify deploy --prod --dir=dist
```

首次使用需要按提示登录 Netlify。

## 手机 Chrome 测试步骤

1. 使用 Vercel 或 Netlify 部署项目，拿到 `https://` 开头的网址。
2. 在手机 Google Chrome 中打开该网址。
3. 点击页面底部的 `开启手势互动`。
4. Chrome 弹出权限请求时，选择允许摄像头。
5. 把手放在前置摄像头前：
   - 移动食指，观察粒子拖尾
   - 手掌靠近，观察粒子推开
   - 拇指和食指捏合，观察粒子聚拢
   - 五指张开，观察粒子散开
6. 如果没有摄像头或权限失败，可以直接触摸屏幕体验备用粒子互动。

## 手机摄像头权限设置

如果误点了拒绝：

1. 在 Chrome 地址栏左侧点击网站信息图标。
2. 进入 `权限` 或 `网站设置`。
3. 找到 `摄像头`。
4. 改为 `允许`。
5. 回到页面后刷新，点击 `开启手势互动`。

如果仍然无法打开摄像头：

- 确认网址是 HTTPS。
- 确认没有其他 App 正在占用摄像头。
- 确认使用的是手机 Google Chrome。
- 尝试关闭页面后重新打开。

## 说明

MediaPipe 模型、WASM 和 JavaScript 包通过 CDN 加载，首次打开需要网络连接。生产环境也可以把这些资源下载到本地托管，减少 CDN 依赖。
