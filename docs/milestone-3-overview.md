# Milestone 3 overview

3A〜3Gは自社単一organization向けのlaunch foundationです。Tags/custom fields/segments、private LINE media、template/campaign、automation/survey/rich menu、tracking/analytics、launch hardeningを分けています。複数organization SaaS、AI、過去履歴同期、広告連携は対象外です。

本番送信と外部変更は既定OFFです。LINE APIが200/409で受理した場合も「LINE受付済み」とだけ表示し、到達・既読を断定しません。Mockではflag OFFでもローカルのpayload/batch/validationを検証できます。
