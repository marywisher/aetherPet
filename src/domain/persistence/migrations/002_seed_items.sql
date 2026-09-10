-- ================================================================
-- 002_seed_items.sql
-- 功能：为 items 表插入 ≥8 条种子物品（对齐 src/domain/gift/item-pool.ts 的 SEED_ITEMS）
-- 阶段 4 交付；requirements §3.7「物品池 ≥8 种」
-- 幂等：使用 INSERT IGNORE（如 id 已存在则跳过）
-- 说明：items 是全局目录，用户不拥有；用户物品栏在 inventory 表
-- ================================================================

INSERT IGNORE INTO items
  (id, display_name, description, icon_path, rarity_weight, category,
   base_price_cents, currency_code, schema_version, hub_id)
VALUES
  ('berry',     '浆果',       '红彤彤的一颗，看起来甜。',            'icons/items/berry.png',      1.2,    'fruit',   NULL, NULL, '1.0.0', 'local'),
  ('dry-leaf',  '枯叶',       '秋天的一片。',                        'icons/items/dry-leaf.png',   1.2,    'plant',   NULL, NULL, '1.0.0', 'local'),
  ('stone',     '石子',       '河边捡的，很圆。',                    'icons/items/stone.png',      1.2,    'stone',   NULL, NULL, '1.0.0', 'local'),
  ('dandelion', '蒲公英',     '一吹就散。',                          'icons/items/dandelion.png',  1.2,    'plant',   NULL, NULL, '1.0.0', 'local'),
  ('pinecone',  '松果',       '松树上掉下来的。',                    'icons/items/pinecone.png',   0.9,    'plant',   NULL, NULL, '1.0.0', 'local'),
  ('dew-grass', '露珠草叶',   '叶尖上还挂着露。',                    'icons/items/dew-grass.png',  0.9,    'plant',   NULL, NULL, '1.0.0', 'local'),
  ('wood-shard','木片',       '窗台上不知何时出现的。',              'icons/items/wood-shard.png', 1.2,    'misc',    NULL, NULL, '1.0.0', 'local'),
  ('shell',     '贝壳',       '很轻，能听见海。',                    'icons/items/shell.png',      0.5,    'misc',    NULL, NULL, '1.0.0', 'local'),
  ('feather',   '羽毛',       '不知道是什么鸟的。',                  'icons/items/feather.png',    0.5,    'misc',    NULL, NULL, '1.0.0', 'local')
;
