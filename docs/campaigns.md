# Campaigns

Campaignはdraft→validate→segment estimate→除外→quota確認→test send→人間承認→snapshot batch→sendの順です。multicastは500件以下のcontact UUID配列を保存し、LINE user IDは送信直前にcontactから解決します。Retry Keyはbatchごとに固定し、409は受付済み、429 quotaはpause、5xx/timeoutは最大3回です。

Broadcastはownerと確認文が必要な危険操作です。配信対象のblocked/suppressedはsnapshot後も送信直前に除外します。
