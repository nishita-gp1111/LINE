import Link from "next/link";

export default function CustomFieldsPage() {
  return <main className="min-h-screen px-6 py-8 sm:px-10"><div className="mx-auto max-w-5xl"><Link href="/admin" className="text-sm text-moss">← 管理画面</Link><h1 className="mt-5 text-3xl font-black">カスタム項目</h1><p className="mt-2 text-sm text-ink/65">型付きの顧客項目を定義し、セグメントで安全に利用します。</p><div className="mt-6 rounded-xl border border-line bg-white p-6"><p className="font-black">対応型</p><p className="mt-2 text-sm text-ink/65">text / long_text / number / date / datetime / boolean / single_select / multi_select</p><p className="mt-5 text-sm text-ink/65">項目定義の無効化と値の型整合はサーバーとDBの両方で確認します。</p></div></div></main>;
}
