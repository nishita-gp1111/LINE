# Surveys

Quick Reply/postbackでLINEトーク内回答を保存します。postbackはopaque・署名・期限付きで、LINE user IDやaction JSONを含めません。回答、tag provenance、custom field、next question/actionは同じidempotency keyで二重処理を防ぎます。複数選択は確定操作、自由回答待機中はkeywordよりsurveyを優先します。
