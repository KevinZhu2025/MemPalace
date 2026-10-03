SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH(N'dbo.Knowledge_doc', N'图片数据') IS NULL
BEGIN
    ALTER TABLE [dbo].[Knowledge_doc]
    ADD [图片数据] VARBINARY(MAX) NULL;
END;

IF COL_LENGTH(N'dbo.Knowledge_doc', N'图片MIME类型') IS NULL
BEGIN
    ALTER TABLE [dbo].[Knowledge_doc]
    ADD [图片MIME类型] NVARCHAR(100) NULL;
END;

DELETE FROM [dbo].[Knowledge_doc]
WHERE [图片编号] IN (N'1.7', N'1.8');

COMMIT TRANSACTION;
