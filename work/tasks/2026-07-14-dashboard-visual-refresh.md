# 管理台视觉统一改造

## 目标
- 将 CPA 管理页、认证文件页和当前后台壳层收敛为统一、克制的运营后台视觉，改善文字层级、色彩语义、表单与操作区的可读性。

## 范围
- `web/src/styles/api-watchmen.scss` 的全局视觉令牌和通用控件。
- `web/src/pages/UsagePage.module.scss` 的 CPA 管理页面布局与响应式样式。
- `web/src/components/usage/credentials/` 的认证文件工具栏和空状态。
- 仅调整表现层，不改变数据加载或操作行为。

## 待办
- [x] 盘点现有页面壳层、设计变量和 CPA 组件。
- [x] 统一页面基础色、字体栈、按钮、输入和卡片的视觉规则。
- [x] 重构 CPA 状态、路径、操作和 API Key 列表的视觉层级。
- [x] 运行类型检查、测试/构建，并进行浏览器截图检查。
- [x] 合并认证文件筛选、视图和操作工具栏，并统一视觉规则。
- [x] 验证认证文件页面在桌面和窄屏下的布局（结构测试和响应式规则检查）。

## 验证
- `npm --prefix ./web run typecheck`
- `npm --prefix ./web run test -- --runInBand`（若当前 Vitest 版本不支持则运行项目既有命令）
- `npm --prefix ./web run build`
- 本地页面截图检查桌面和移动布局。

## 风险/阻塞
- 工作区已有未提交的前端壳层改动；只能在其基础上增量调整，不能回退或覆盖。
