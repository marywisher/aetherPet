# aetherPet 官方默认素材包

手绘暖调风格 + 废话/诗意文案。

## 目录结构

```
default/
├── manifest.json           # 素材包清单
├── theme.css               # CSS 变量（颜色、字体、间距）
├── images/                 # 图片资源（SVG 占位）
│   ├── home-bg.svg         # 家的背景
│   └── letter-bg.svg       # 信纸背景
└── text/                   # 每个事件类型的文案
    ├── outing.json
    ├── watching-water.json
    ├── counting-leaves.json
    ├── self-talk.json
    ├── brought-item.json
    ├── reply-letter.json
    ├── spontaneous-letter.json
    ├── aggregate-summary.json
    ├── system-announce.json
    ├── daily-grant.json
    └── offer-received.json
```

## 阶段说明

- **阶段 1**：manifest + theme.css + 图片 + 占位文案（本包）
- **阶段 2**：文案补齐为"日常废话 vs 诗意 9:1"的完整版本
- **阶段 6**：开发者模式支持切换到其它素材包

## Placeholder 规范

- `{pet_name}` — 宠物名字
- `{item}` / `{item_name}` — 物品名
- `{count}` — 数字（如数叶子）
- `{duration_hours}` / `{duration_minutes}` — 时长
- `{destination}` / `{place}` — 地点
- `{span_days}` — 聚合跨度天数
- `{outings}` — 出门次数
- `{items_collected}` — 收集的物品汇总
- `{recall_line}` — 记忆引用行（由事件引擎注入）
- `{announcement_title}` / `{announcement_body}` — 公告标题/正文

## 记忆引用高亮

事件卡片的 `memory_refs` 数组值会被前端包上 `<span data-mem>`，
CSS 通过 `--pack-memory-ref` 变量上色。
