-- 模型能否看图（多模态输入）。空 = 未设置：内置目录里的模型按目录，自定义模型按只收文字。
ALTER TABLE ai_models ADD COLUMN supports_images BOOLEAN;
