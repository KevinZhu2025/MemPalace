\#对话框输入的场景和规则如下。

\##用户输入知识点文本内容并同时上传图片，那就表示用户已经准备好了知识和记忆锚点图片，程序完成如下动作。

1\. 对于“英文”学科，输入文本的格式为：

* Subject:English 
* Knowledges :Due to oversight of his tendency towar	d infidelity, intimate relationship with adolescents inevitably seduces him to commit adultery.

2\. 对于“科学工具”学科，输入文本的格式为：

* Subject:Tools
* Knowledges : How to write.

3\. 在数据库表里为上传的图片进行登记。

* 如果Subject为"English", 上层图片=1, 图片层级=2,图片编号以上层图片的值+"."+新增序号的方式生成。
* 如果Subject为"Tools",上层图片=2, 图片层级=2,图片编号以上层图片的值+"."+新增序号的方式生成。

4\.保存图片到路径gallery/，图片名为图片编号，图片格式为png



\##用户输入知识点文本但没有上传图片，那就表示用户需要根据提示词调用大模型API来返回文生图提示词，然后再输入文生图提示词给大模型并返回图片，程序完成如下动作。

1. 用户输入的知识点文本需要有 Code，Decode，English sentences这三个组成部分，如果缺失提示用户补全。
2. 输入大模型的提示词为“I want to leaverage Memory palace skill to learn english. The idea is to use values in 'code' and 'decode' values  as memory anchors to remember one sentences. Even more, I wish to create images which are high related to the sentences. I need you to generate and return prompts for creating images. Here is the code,decode and English sentences" , 然后添加 code: + 用户输入，Decode + 用户输入，English sentences+用户输入
3. 登记数据库表
* 大模型返回的提示词存放在字段\*图像提示词\*
* 用户输入的Code+Decode+English sentences存放在字段\*知识点\*
* 上层图片=1, 图片层级=2,图片编号以上层图片的值+"."+新增序号的方式生成。





