# Media

`line-public-media`はURLを知る人が取得可能なLINE公開配信用bucketです。個人情報、HTML、SVG、executableを保存しません。JPEG/PNG、MP4+preview、MP3/M4A+durationをMIME/拡張子/magic bytesと容量で検証し、Service Roleをbrowserへ渡しません。stop thresholdではuploadだけ止め、既存送信は壊しません。過去メッセージの再生が壊れるため削除時に警告します。
