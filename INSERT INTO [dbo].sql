INSERT INTO [dbo].[Knowledge_doc] (
    [图像提示词],
    [图片位置],
    [图片层级],
    [图片编号],
    [上层图片],
    [知识点],
    [显示方式]
)
SELECT
    v.[图像提示词],
    v.[图片位置],
    v.[图片层级],
    v.[图片编号],
    v.[上层图片],
    v.[知识点],
    v.[显示方式]
FROM (VALUES
    (N'英国古堡大门', N'gallery/1.png', 1, N'1', N'无', N'英语', N'固定'),

    (N'老旧扶手椅上坐着一位官僚，胸前贴着姓名“DYH"', N'gallery/1.1.png', 2, N'1.1', N'1',
     N'Clumsy bureaucracy institutionalized by constitution causes systemic dysfunction and leads the country into the mire.', N'悬浮'),

    (N'现代化豪宅大门，带大屏对话功能，密码锁键盘，铭牌写“科学工具”', N'gallery/2.png', 1, N'2', N'无',
     N'科学工具', N'固定'),

    (N'无', N'gallery/2.1.png', 2, N'2.1', N'2',
     N'Focus on the Graphic', N'悬浮'),

    (N'', N'gallery/1.2.png', 2, N'1.2', N'1',
     N'I can''t account for the substantial expense in this project but will take into account audit for all spending.', N'悬浮'),

    (N'', N'gallery/1.3.png', 2, N'1.3', N'1',
     N'Reputable gentleman from prestigious colleage can''t absolve him from sins.', N'悬浮'),

    (N'', N'gallery/1.4.png', 2, N'1.4', N'1',
     N'When the terrified solider got equilibrium, the officer debriefed him. The trepidation of failure is instilled in him. It entails losing motiation of fight.', N'悬浮'),

    (N'', N'gallery/1.5.png', 2, N'1.5', N'1',
     N'Two subordinate officers clash in the meeting. Savage indigenous population act as disobedience or rebellion. I defy the commander to make judgement.', N'悬浮'),

    (N'', N'gallery/1.6.png', 2, N'1.6', N'1',
     N'Partisans are imparted invincible beliefs in 10 consecutive years and have instincts of satirizing hypocrisy', N'悬浮')
) AS v (
    [图像提示词],
    [图片位置],
    [图片层级],
    [图片编号],
    [上层图片],
    [知识点],
    [显示方式]
)
WHERE NOT EXISTS (
    SELECT 1
    FROM [dbo].[Knowledge_doc] AS existing
    WHERE existing.[图片编号] = v.[图片编号]
);