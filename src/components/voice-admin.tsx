"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogueVoice, Gender, VoiceChoice } from "@/types/studio";

type Session = { authenticated: boolean; configured: boolean; storageReady: boolean };
type Library = { voices: VoiceChoice[]; revision: string; catalogue: CatalogueVoice[]; warnings: string[] };
async function responseJson(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Yêu cầu chưa thành công.");
  return data;
}
export default function VoiceAdmin() {
  const [session, setSession] = useState<Session | null>(null);
  const [password, setPassword] = useState("");
  const [library, setLibrary] = useState<Library | null>(null);
  const [choices, setChoices] = useState<Record<string, VoiceChoice>>({});
  const [genders, setGenders] = useState<Record<string, Gender | "unknown">>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CatalogueVoice | null>(null);
  const dirtyRef = useRef(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result: Library = await responseJson(await fetch("/api/admin/voices", { cache: "no-store" }));
      setLibrary(result); setPage(0); setChoices(Object.fromEntries(result.voices.map((voice) => [voice.id, voice])));
      setGenders(Object.fromEntries(result.voices.map((voice) => [voice.id, voice.gender])));
      dirtyRef.current = false;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Chưa tải được thư viện."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/session", { cache: "no-store", signal: controller.signal }).then(responseJson).then((data) => {
      setSession(data); if (data.authenticated) void load();
    }).catch(() => { if (!controller.signal.aborted) setMessage("Không kiểm tra được đăng nhập. Hãy tải lại trang."); });
    const guard = (event: BeforeUnloadEvent) => { if (dirtyRef.current) event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => { controller.abort(); window.removeEventListener("beforeunload", guard); };
  }, [load]);
  const rows = useMemo(() => {
    const available = library?.catalogue || [];
    const retained = (library?.voices || []).filter((voice) => !available.some((row) => row.id === voice.id)).map((voice) => ({ ...voice, ready: true, status: "saved" }));
    return [...available, ...retained].filter((voice) =>
      (filter === "all" || (filter === "selected" ? Boolean(choices[voice.id]) : voice.source === filter)) &&
      `${voice.name} ${voice.id} ${voice.language}`.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi")))
      .sort((a, b) => Number(b.source === "clone") - Number(a.source === "clone") || Number(b.language === "vi") - Number(a.language === "vi") || a.name.localeCompare(b.name, "vi"));
  }, [library, query, filter, choices]);
  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await responseJson(await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }));
      setPassword(""); setSession({ authenticated: true, configured: true, storageReady: true }); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Đăng nhập chưa thành công."); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!library) return;
    setBusy(true); setMessage("");
    try {
      const saved = await responseJson(await fetch("/api/admin/voices", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voices: Object.values(choices), revision: library.revision }) }));
      setLibrary((current) => current ? { ...current, ...saved } : current); dirtyRef.current = false;
      setMessage(`Đã lưu ${saved.voices.length} giọng dùng chung. Danh sách mới áp dụng trên mọi thiết bị.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Chưa lưu được thay đổi."); }
    finally { setBusy(false); }
  };
  return <main className="app-shell admin-shell">
    <header className="topbar"><Link className="brand" href="/"><strong>Song Kiếm AI</strong></Link><Link className="admin-link" href="/">← Về studio</Link></header>
    <section className="admin-intro"><p className="eyebrow">QUẢN TRỊ</p><h1>Thư viện giọng đọc</h1><p>Chọn các giọng từ Saydi để hiển thị trong danh sách của Nhân vật A và B. Danh sách dùng chung cho mọi thiết bị.</p></section>
    {message && <p className="notice" role="status">{message}</p>}
    {!session ? <p>Đang kiểm tra đăng nhập...</p> : !session.authenticated ? <form className="panel admin-login" onSubmit={(event) => void login(event)}>
      <h2>Đăng nhập quản trị</h2>
      {(!session.configured || !session.storageReady) && <p role="status">Quản trị đang chờ cài đặt trên máy chủ. Cần mật khẩu quản trị từ 12 ký tự và kho cấu hình giọng đã kết nối.</p>}
      <label className="field"><span>Mật khẩu quản trị</span><input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button type="submit" className="button primary" disabled={busy || !session.configured || !session.storageReady}>{busy ? "Đang đăng nhập..." : "Đăng nhập"}</button>
    </form> : <>
      <div className="admin-toolbar"><div><strong>{Object.keys(choices).length} giọng được chọn</strong><small>Bỏ chọn chỉ ẩn giọng khỏi studio, không xóa giọng trên Saydi.</small></div><div className="action-row">
        <button className="button ghost" disabled={busy} onClick={() => { if (!dirtyRef.current || window.confirm("Tải lại sẽ bỏ các thay đổi chưa lưu. Tiếp tục?")) void load(); }}>Tải lại từ Saydi</button>
        <button className="button primary" disabled={busy || !library} onClick={() => void save()}>{busy ? "Đang xử lý..." : "Lưu danh sách dùng chung"}</button>
        <button className="button ghost" disabled={busy} onClick={async () => { try { await responseJson(await fetch("/api/admin/session", { method: "DELETE" })); setSession({ ...session, authenticated: false }); setLibrary(null); setPreview(null); dirtyRef.current = false; } catch { setMessage("Chưa đăng xuất được. Hãy thử lại."); } }}>Đăng xuất</button>
      </div></div>
      {library?.warnings.map((warning) => <p className="notice error" role="alert" key={warning}>{warning}. Danh sách đã lưu được giữ nguyên.</p>)}
      <div className="admin-filters"><label className="field"><span>Tìm tên hoặc mã giọng</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Tìm giọng Saydi..." /></label>
        <label className="field"><span>Loại giọng</span><select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}><option value="all">Tất cả giọng</option><option value="system">Giọng hệ thống</option><option value="clone">Giọng clone của tôi</option><option value="selected">Đã chọn sử dụng</option></select></label></div>
      {preview && <div className="panel voice-preview"><strong>Nghe mẫu: {preview.name}</strong><audio key={preview.id} controls autoPlay src={`/api/voices/preview?id=${encodeURIComponent(preview.id)}`} onError={() => setMessage("Không tải được mẫu giọng này. Hãy thử lại.")} /><button className="button ghost compact" onClick={() => setPreview(null)}>Dừng nghe</button></div>}
      <div className="catalogue-pages"><span>{rows.length} giọng phù hợp · Trang {Math.min(page, Math.max(0, Math.ceil(rows.length/30)-1)) + 1}/{Math.max(1, Math.ceil(rows.length/30))}</span><div className="action-row"><button className="button ghost compact" disabled={page === 0} onClick={() => setPage((current) => Math.max(0,current-1))}>Trang trước</button><button className="button ghost compact" disabled={(page+1)*30 >= rows.length} onClick={() => setPage((current) => current+1)}>Trang sau</button></div></div>
      <div className="voice-catalogue" aria-busy={busy}>{rows.slice(Math.min(page, Math.max(0, Math.ceil(rows.length/30)-1))*30, (Math.min(page, Math.max(0, Math.ceil(rows.length/30)-1))+1)*30).map((voice) => {
        const selected = choices[voice.id]; const gender = genders[voice.id] || voice.gender;
        return <article className={`panel catalogue-card ${selected ? "selected" : ""}`} key={voice.id}>
          <label className="voice-select"><input type="checkbox" checked={Boolean(selected)} disabled={busy || !voice.ready} onChange={(event) => {
            if (event.target.checked && gender === "unknown") { setMessage("Hãy chọn Nam hoặc Nữ cho giọng này trước khi đưa vào danh sách."); return; }
            dirtyRef.current = true;
            setChoices((current) => { const next = { ...current }; if (event.target.checked) next[voice.id] = { id: voice.id, name: voice.name, gender: gender as Gender, source: voice.source, language: voice.language }; else delete next[voice.id]; return next; });
          }} /><span>{voice.name}</span></label>
          <div className="catalogue-meta"><span>{voice.source === "clone" ? "GIỌNG CLONE" : "HỆ THỐNG"}</span><span>{voice.language || "Chưa rõ ngôn ngữ"}</span><span>{voice.status === "saved" ? "Đã lưu, chưa xác minh từ Saydi" : voice.ready ? "Sẵn sàng" : voice.status === "processing" ? "Đang xử lý" : "Chưa sẵn sàng"}</span></div>
          <small className="voice-id">{voice.id}</small>
          <label className="field"><span>Giới tính của giọng</span><select disabled={busy} value={gender} onChange={(event) => {
            const value = event.target.value as Gender; setGenders((current) => ({ ...current, [voice.id]: value }));
            if (selected) { dirtyRef.current = true; setChoices((current) => ({ ...current, [voice.id]: { ...selected, gender: value } })); }
          }}><option value="unknown" disabled>Chọn giới tính</option><option value="male">Nam</option><option value="female">Nữ</option></select></label>
          <button className="button ghost compact" disabled={!voice.ready || busy} onClick={() => setPreview(voice)}>Nghe mẫu</button>
        </article>;
      })}</div>
      {!busy && !rows.length && <p>Không có giọng phù hợp với bộ lọc hiện tại.</p>}
    </>}
  </main>;
}
