# BinGO 版本命名约定

所有产品（Windows 学生端、Windows 教师端、iPad 学生端、服务器、GitHub Release）统一使用同一套罗马地名代号。

## 规则

- 整大版本（5.0、6.0……）用第一列的名字，例如 **5.0 = Rome**。
- 小版本（5.1、5.2……）依次用第二列的城市名，例如 **5.1 = Ostia**、**5.2 = Pompeii**。
- 补丁号不单独命名，写作 `5.1.0`、`5.1.1`。
- 完整称呼：`Ostia 5.1.0`。
- GitHub Release 标题：`BinGO <版本> · <代号>`，例如 `BinGO 5.1.0 · Ostia`。

## 命名表

| 大版本 | 小版本（按序取用） |
| --- | --- |
| 5.0 = Rome | Ostia、Pompeii、Neapolis、Capua、Florentia、Patavium、Ravenna、Mediolanum |
| 6.0 = Londinium | Eboracum、Camulodunum、Aquae Sulis、Verulamium、Corinium、Lindum |
| 7.0 = Lugdunum | Lutetia、Avaricum、Rotomagus、Agedincum、Augustodunum、Cenabum |
| 8.0 = Tarraco | Barcino、Valentia、Caesaraugusta、Corduba、Hispalis、Toletum |
| 9.0 = Carthago | Utica、Hadrumetum、Leptis Magna、Thysdrus、Cirta、Bulla Regia |
| 10.0 = Alexandria | Memphis、Thebae、Oxyrhynchus、Hermopolis、Naucratis |
| 11.0 = Antiochia | Damascus、Palmyra、Berytus、Hierapolis、Apamea |
| 12.0 = Constantinopolis | Philippopolis、Adrianopolis、Serdica、Marcianopolis |

## 代码实现

- 命名表唯一数据源：`packages/sync-server/src/release.ts`（`RELEASE_PROVINCES`）。
- 服务器根据 `BINGO_RELEASE_VERSION` 自动推导代号：`.0` 用大版本名，小版本取城市名（可用 `BINGO_RELEASE_CODENAME` 环境变量覆盖）。
- 新增大版本时：在 `RELEASE_PROVINCES` 追加一行，并更新本文档。
