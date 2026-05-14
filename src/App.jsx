import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  Bell,
  CheckCircle2,
  Crown,
  Download,
  Edit3,
  FileSpreadsheet,
  KeyRound,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import "./styles.css";

const DB = "https://smile-of-kswa-default-rtdb.firebaseio.com";
const ADMIN_ID = "admin";
const ADMIN_PW = "kswa2026";
const REVIEW_MILEAGE = 30000;
const MAX_MILEAGE = 1200000;
const PASSWORD_RULE = /^[A-Za-z]{4}\d{4}$/;

const STORAGE = {
  user: "smile_user",
  admin: "smile_admin",
  data: "smile_data",
};

const EMPTY_DATA = {
  members: [],
  signupRequests: [],
  mileageRecords: [],
  messages: [],
  messageReads: [],
  pwRequests: [],
  withdrawals: [],
};

function App() {
  const [data, setData] = useState(readLocalData);
  const [user, setUser] = useState(() => readStorage(STORAGE.user, null));
  const [isAdmin, setIsAdmin] = useState(() => readStorage(STORAGE.admin, false));
  const [page, setPage] = useState(user ? "home" : "auth");
  const [authMode, setAuthMode] = useState("login");
  const [adminTab, setAdminTab] = useState("mileage");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const dataRef = useRef(data);

  function updateData(next) {
    dataRef.current = next;
    setData(next);
    writeStorage(STORAGE.data, next);
  }

  const sessionUser = useMemo(() => {
    if (!user || isAdmin) return user;
    return data.members.find((member) => member.id === user.id) || user;
  }, [data.members, isAdmin, user]);

  const isSubAdmin = !isAdmin && isSubAdminMember(sessionUser);
  const canAdmin = isAdmin || isSubAdmin;
  const readerId = isAdmin ? "admin" : sessionUser?.id || "";
  const userMessages = useMemo(
    () => getVisibleMessages(data.messages, sessionUser, isAdmin),
    [data.messages, sessionUser, isAdmin],
  );
  const adminMessages = useMemo(
    () => data.messages.filter((item) => item.recipientId === "admin").sort(sortNewest),
    [data.messages],
  );
  const unreadUserCount = userMessages.filter((item) => !isMessageRead(data.messageReads, sessionUser?.id, item.id)).length;
  const unreadAdminCount = canAdmin ? adminMessages.filter((item) => !isMessageRead(data.messageReads, readerId, item.id)).length : 0;
  const pendingSignupCount = isAdmin ? data.signupRequests.filter((item) => item.status === "pending").length : 0;
  const pendingPwCount = data.pwRequests.filter((item) => item.status === "pending").length;

  async function refreshData({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const remote = await fetchRemoteData();
      updateData(remote);
      if (sessionUser?.id && !isAdmin) {
        const freshUser = remote.members.find((member) => member.id === sessionUser.id);
        if (freshUser) {
          setUser(freshUser);
          writeStorage(STORAGE.user, freshUser);
        }
      }
      return remote;
    } catch (err) {
      console.error(err);
      if (!silent) setError("Firebase 데이터를 불러오지 못했습니다.");
      return dataRef.current;
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function login(form) {
    clearAlerts();
    if (!form.name.trim() || !form.password.trim()) {
      setError("이름과 비밀번호를 입력해주세요. 비밀번호는 영어 4자리 + 숫자 4자리입니다.");
      return;
    }
    if (form.name.trim() === ADMIN_ID && form.password.trim() === ADMIN_PW) {
      setLoading(true);
      const remote = await fetchRemoteData().catch(() => dataRef.current);
      updateData(remote);
      const adminUser = { id: "admin", name: "관리자" };
      setUser(adminUser);
      setIsAdmin(true);
      writeStorage(STORAGE.user, adminUser);
      writeStorage(STORAGE.admin, true);
      setPage("home");
      setLoading(false);
      return;
    }
    if (!PASSWORD_RULE.test(form.password.trim())) {
      setError("비밀번호는 영어 4자리 + 숫자 4자리 형식입니다. 예: abcd1234");
      return;
    }
    setLoading(true);
    try {
      const remote = await fetchRemoteData();
      updateData(remote);
      const member = pickLatest(
        remote.members.filter((item) => item.name === form.name.trim() && item.password === form.password.trim()),
      );
      if (!member) {
        const pending = remote.signupRequests.find(
          (item) => item.name === form.name.trim() && item.password === form.password.trim() && item.status === "pending",
        );
        setError(pending ? "가입 신청이 아직 관리자 승인 대기 중입니다." : "이름 또는 비밀번호가 일치하지 않습니다.");
        return;
      }
      setUser(member);
      setIsAdmin(false);
      writeStorage(STORAGE.user, member);
      writeStorage(STORAGE.admin, false);
      setPage("home");
      setMessage(`${member.name}님, 환영합니다.`);
    } finally {
      setLoading(false);
    }
  }

  async function register(form) {
    clearAlerts();
    if (!form.name.trim() || !form.affiliation.trim() || !form.phone.trim()) {
      setError("이름, 소속, 전화번호를 모두 입력해주세요.");
      return;
    }
    if (!PASSWORD_RULE.test(form.password)) {
      setError("비밀번호는 영어 4자리 + 숫자 4자리 형식입니다. 예: abcd1234");
      return;
    }
    if (form.password !== form.passwordConfirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setLoading(true);
    try {
      const remote = await fetchRemoteData();
      const duplicateMember = remote.members.some((item) => item.name === form.name.trim() && item.phone === form.phone.trim());
      const duplicateRequest = remote.signupRequests.some((item) => item.status === "pending" && item.name === form.name.trim() && item.phone === form.phone.trim());
      if (duplicateMember || duplicateRequest) {
        setError("이미 등록되었거나 승인 대기 중인 가입 신청이 있습니다.");
        return;
      }
      const request = {
        id: makeId("signup"),
        name: form.name.trim(),
        affiliation: form.affiliation.trim(),
        phone: form.phone.trim(),
        password: form.password,
        status: "pending",
        requestedAt: now(),
      };
      await fbPatch("signupRequests", { [firebaseKey(request.id)]: cleanFirebase(request) });
      updateData({ ...remote, signupRequests: [request, ...remote.signupRequests] });
      setAuthMode("login");
      setMessage("가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function submitPwRequest(form) {
    clearAlerts();
    if (!form.name.trim() || !form.phone.trim()) {
      setError("이름과 전화번호를 입력해주세요.");
      return;
    }
    setLoading(true);
    try {
      const remote = await fetchRemoteData();
      const member = pickLatest(remote.members.filter((item) => item.name === form.name.trim() && item.phone === form.phone.trim()));
      const exists = remote.pwRequests.some((item) => item.status === "pending" && item.name === form.name.trim() && item.phone === form.phone.trim());
      if (exists) {
        setError("이미 처리 대기 중인 비밀번호 요청이 있습니다.");
        return;
      }
      const req = {
        id: makeId("pw"),
        memberId: member?.id || "",
        name: form.name.trim(),
        phone: form.phone.trim(),
        message: form.message.trim(),
        resolvedPassword: member?.password || "",
        status: "pending",
        createdAt: now(),
      };
      const adminMessage = buildPwAdminMessage(req, member);
      await fbPatch("pwRequests", { [firebaseKey(req.id)]: cleanFirebase(req) });
      await fbPatch("messages", { [firebaseKey(adminMessage.id)]: cleanFirebase(adminMessage) });
      updateData({
        ...remote,
        pwRequests: [req, ...remote.pwRequests],
        messages: [adminMessage, ...remote.messages],
      });
      setAuthMode("login");
      setMessage("비밀번호 요청이 관리자에게 전달되었습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function approveSignup(req) {
    if (!isAdmin) throw new Error("가입 승인은 관리자만 할 수 있습니다.");
    const member = {
      id: makeId("member"),
      name: req.name,
      affiliation: req.affiliation,
      phone: req.phone,
      password: req.password,
      role: "member",
      joinedAt: now(),
      updatedAt: now(),
    };
    const reviewed = { ...req, status: "approved", reviewedAt: now() };
    await fbPatch("members", { [firebaseKey(member.id)]: cleanFirebase(member) });
    await fbPatch("signupRequests", { [firebaseRecordKey(req, req.id)]: cleanFirebase(reviewed) });
    updateData({
      ...dataRef.current,
      members: upsertById(dataRef.current.members, member),
      signupRequests: upsertById(dataRef.current.signupRequests, reviewed),
    });
  }

  async function rejectSignup(req) {
    if (!isAdmin) throw new Error("가입 승인은 관리자만 할 수 있습니다.");
    const reviewed = { ...req, status: "rejected", reviewedAt: now() };
    await fbPatch("signupRequests", { [firebaseRecordKey(req, req.id)]: cleanFirebase(reviewed) });
    updateData({ ...dataRef.current, signupRequests: upsertById(dataRef.current.signupRequests, reviewed) });
  }

  async function toggleSubAdmin(member) {
    if (!isAdmin) throw new Error("부관리자 지정은 관리자만 할 수 있습니다.");
    const selected = isSubAdminMember(member);
    if (!selected && dataRef.current.members.filter(isSubAdminMember).length >= 4) {
      throw new Error("부관리자는 최대 4명까지 지정할 수 있습니다.");
    }
    const updated = { ...member, role: selected ? "member" : "subAdmin", updatedAt: now() };
    await fbPatch("members", { [firebaseRecordKey(member, member.id)]: cleanFirebase(updated) });
    updateData({ ...dataRef.current, members: upsertById(dataRef.current.members, updated) });
  }

  async function forceWithdraw(member) {
    if (!isAdmin) throw new Error("강제 탈퇴는 관리자만 할 수 있습니다.");
    if (!window.confirm(`${member.name}님을 강제 탈퇴 처리할까요?`)) return;
    const item = {
      id: makeId("withdraw"),
      memberId: member.id,
      name: member.name,
      affiliation: member.affiliation,
      phone: member.phone,
      withdrawnAt: now(),
      withdrawnBy: "관리자",
    };
    await fbPatch("withdrawals", { [firebaseKey(item.id)]: cleanFirebase(item) });
    await fbDelete(`members/${firebaseRecordKey(member, member.id)}`);
    updateData({
      ...dataRef.current,
      members: dataRef.current.members.filter((entry) => entry.id !== member.id),
      withdrawals: [item, ...dataRef.current.withdrawals],
    });
  }

  async function saveMileage(form, editingRecord = null) {
    if (!canAdmin) throw new Error("마일리지는 관리자와 부관리자만 기록할 수 있습니다.");
    const member = dataRef.current.members.find((item) => item.id === form.memberId);
    if (!member) throw new Error("심사자를 선택해주세요.");
    const amount = form.type === "earn" ? REVIEW_MILEAGE : Number(form.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("마일리지 금액을 입력해주세요.");
    const otherRecords = dataRef.current.mileageRecords.filter((item) => item.id !== editingRecord?.id);
    const currentBalance = mileageSummary(member.id, otherRecords).balance;
    if (form.type === "earn" && currentBalance + amount > MAX_MILEAGE) {
      throw new Error("최대 120만 마일리지까지 적립할 수 있습니다.");
    }
    if ((form.type === "use" || form.type === "deduct") && currentBalance - amount < 0) {
      throw new Error("현재 남은 마일리지보다 큰 금액은 사용할 수 없습니다.");
    }
    const record = {
      ...(editingRecord || {}),
      id: editingRecord?.id || makeId("mileage"),
      memberId: member.id,
      memberName: member.name,
      memberAffiliation: member.affiliation,
      memberPhone: member.phone,
      type: form.type,
      amount,
      volume: form.volume.trim(),
      issue: form.issue.trim(),
      note: form.note.trim(),
      updatedAt: now(),
      createdAt: editingRecord?.createdAt || now(),
      editorId: isAdmin ? "admin" : sessionUser.id,
      editorName: isAdmin ? "관리자" : sessionUser.name,
    };
    await fbPatch("mileageRecords", { [firebaseRecordKey(record, record.id)]: cleanFirebase(record) });
    updateData({ ...dataRef.current, mileageRecords: upsertById(dataRef.current.mileageRecords, record).sort(sortNewest) });
  }

  async function deleteMileage(record) {
    if (!canAdmin) return;
    if (!window.confirm("마일리지 기록을 삭제할까요?")) return;
    await fbDelete(`mileageRecords/${firebaseRecordKey(record, record.id)}`);
    updateData({ ...dataRef.current, mileageRecords: dataRef.current.mileageRecords.filter((item) => item.id !== record.id) });
  }

  async function sendMessage(form) {
    if (!canAdmin || !form.content.trim()) return;
    const recipient = form.recipientId === "all" ? null : dataRef.current.members.find((item) => item.id === form.recipientId);
    if (form.recipientId !== "all" && !recipient) throw new Error("받는 회원을 선택해주세요.");
    const item = {
      id: makeId("message"),
      recipientId: form.recipientId,
      recipientName: recipient ? memberLabel(recipient) : "전체 회원",
      scope: form.recipientId === "all" ? "all" : "member",
      title: form.title.trim() || "Smile 공지",
      content: form.content.trim(),
      senderId: isAdmin ? "admin" : sessionUser.id,
      senderName: isAdmin ? "관리자" : `${sessionUser.name} 부관리자`,
      createdAt: now(),
    };
    await fbPatch("messages", { [firebaseKey(item.id)]: cleanFirebase(item) });
    updateData({ ...dataRef.current, messages: [item, ...dataRef.current.messages] });
  }

  async function markRead(message) {
    if (!sessionUser?.id || !message?.id) return;
    const key = `${sessionUser.id}_${message.id}`;
    if (isMessageRead(dataRef.current.messageReads, sessionUser.id, message.id)) return;
    const item = { key, memberId: sessionUser.id, messageId: message.id, readAt: now() };
    await fbPatch("messageReads", { [firebaseKey(key)]: cleanFirebase(item) });
    updateData({ ...dataRef.current, messageReads: upsertByKey(dataRef.current.messageReads, item, "key") });
  }

  async function markAdminRead(message) {
    if (!canAdmin || !readerId || !message?.id) return;
    const key = `${readerId}_${message.id}`;
    if (isMessageRead(dataRef.current.messageReads, readerId, message.id)) return;
    const item = { key, memberId: readerId, messageId: message.id, readAt: now() };
    await fbPatch("messageReads", { [firebaseKey(key)]: cleanFirebase(item) });
    updateData({ ...dataRef.current, messageReads: upsertByKey(dataRef.current.messageReads, item, "key") });
  }

  async function resolvePwRequest(req) {
    if (!canAdmin) return;
    const updated = { ...req, status: "done", resolvedAt: now() };
    await fbPatch("pwRequests", { [firebaseRecordKey(req, req.id)]: cleanFirebase(updated) });
    updateData({ ...dataRef.current, pwRequests: upsertById(dataRef.current.pwRequests, updated) });
  }

  async function deleteMessage(message) {
    if (!canAdmin) return;
    await fbDelete(`messages/${firebaseRecordKey(message, message.id)}`);
    updateData({ ...dataRef.current, messages: dataRef.current.messages.filter((item) => item.id !== message.id) });
  }

  async function exportExcel() {
    if (!canAdmin) return;
    setLoading(true);
    try {
      const latest = await fetchRemoteData();
      updateData(latest);
      downloadExcel(latest);
    } catch {
      downloadExcel(dataRef.current);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setUser(null);
    setIsAdmin(false);
    writeStorage(STORAGE.user, null);
    writeStorage(STORAGE.admin, false);
    setPage("auth");
    setAuthMode("login");
  }

  function clearAlerts() {
    setError("");
    setMessage("");
  }

  if (!user) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        login={login}
        register={register}
        submitPwRequest={submitPwRequest}
        loading={loading}
        message={message}
        error={error}
      />
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setPage("home")}>
          <span>Smile</span>
          <strong>심사 Mileage</strong>
        </button>
        <nav>
          <button className={page === "home" ? "active" : ""} type="button" onClick={() => setPage("home")}><BarChart3 size={17} /> 홈</button>
          <button className={[page === "messages" ? "active" : "", unreadUserCount ? "has-unread" : ""].filter(Boolean).join(" ")} type="button" onClick={() => setPage("messages")}><Mail size={17} /> 쪽지함{unreadUserCount ? ` ${unreadUserCount}` : ""}</button>
          {canAdmin && <button className={[page === "adminMessages" ? "active" : "", unreadAdminCount ? "has-unread" : ""].filter(Boolean).join(" ")} type="button" onClick={() => setPage("adminMessages")}><Mail size={17} /> 관리자쪽지{unreadAdminCount ? ` ${unreadAdminCount}` : ""}</button>}
          {canAdmin && <button className={page === "admin" ? "active" : ""} type="button" onClick={() => setPage("admin")}><ShieldCheck size={17} /> 관리자{pendingSignupCount + pendingPwCount || ""}</button>}
        </nav>
        <div className="session">
          <span>{isAdmin ? <><Crown className="admin-crown" size={24} /> 관리자</> : <>{sessionUser?.name}{isSubAdmin && <small><Crown size={13} /> 부관리자</small>}</>}</span>
          <button type="button" onClick={logout}><LogOut size={16} /> 로그아웃</button>
        </div>
      </header>

      {(message || error) && <div className={error ? "alert error" : "alert"}>{error || message}</div>}

      {page === "home" && <HomePage user={sessionUser} data={data} isAdmin={isAdmin} canAdmin={canAdmin} refresh={() => refreshData()} loading={loading} />}
      {page === "messages" && !isAdmin && <MessagesPage messages={userMessages} reads={data.messageReads} user={sessionUser} markRead={markRead} />}
      {page === "adminMessages" && canAdmin && <AdminMessages messages={adminMessages} sent={data.messages.filter((item) => item.senderId === "admin" || item.senderId === sessionUser?.id)} reads={data.messageReads} readerId={readerId} markRead={markAdminRead} deleteMessage={deleteMessage} />}
      {page === "admin" && canAdmin && (
        <AdminPage
          data={data}
          tab={adminTab}
          setTab={setAdminTab}
          isAdmin={isAdmin}
          canAdmin={canAdmin}
          loading={loading}
          approveSignup={approveSignup}
          rejectSignup={rejectSignup}
          toggleSubAdmin={toggleSubAdmin}
          forceWithdraw={forceWithdraw}
          saveMileage={saveMileage}
          deleteMileage={deleteMileage}
          sendMessage={sendMessage}
          resolvePwRequest={resolvePwRequest}
          exportExcel={exportExcel}
          refresh={() => refreshData()}
        />
      )}
    </main>
  );
}

function AuthScreen({ mode, setMode, login, register, submitPwRequest, loading, message, error }) {
  return (
    <main className="auth">
      <section className="auth-card">
        <img src="/assets/kswa-main.png" alt="한국사회복지행정학회" />
        <h1>Smile</h1>
        <p>한국사회복지행정학 심사 Mileage</p>
        <div className="notice">비밀번호는 <strong>영어 4자리 + 숫자 4자리</strong> 총 8자리입니다. 예: <strong>abcd1234</strong></div>
        <div className="tabs">
          <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>로그인</button>
          <button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}>신규 가입</button>
          <button className={mode === "pw" ? "active" : ""} type="button" onClick={() => setMode("pw")}>비번 요청</button>
        </div>
        {(message || error) && <div className={error ? "alert error" : "alert"}>{error || message}</div>}
        {mode === "login" && <LoginForm login={login} loading={loading} />}
        {mode === "register" && <RegisterForm register={register} loading={loading} />}
        {mode === "pw" && <PwRequestForm submitPwRequest={submitPwRequest} loading={loading} />}
      </section>
    </main>
  );
}

function LoginForm({ login, loading }) {
  const [form, setForm] = useState({ name: "", password: "" });
  return (
    <form className="form" onSubmit={(event) => { event.preventDefault(); login(form); }}>
      <label>이름 또는 관리자 ID<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="이름 입력" /></label>
      <label>비밀번호<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="영어4+숫자4 예: abcd1234" /></label>
      <button className="primary" disabled={loading} type="submit">로그인</button>
    </form>
  );
}

function RegisterForm({ register, loading }) {
  const [form, setForm] = useState({ name: "", affiliation: "", phone: "", password: "", passwordConfirm: "" });
  return (
    <form className="form" onSubmit={(event) => { event.preventDefault(); register(form); }}>
      <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="이름" />
      <input value={form.affiliation} onChange={(event) => setForm({ ...form, affiliation: event.target.value })} placeholder="소속" />
      <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="전화번호" />
      <div className="notice">비밀번호는 영어 4자리 + 숫자 4자리입니다. 예: abcd1234</div>
      <div className="two">
        <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="비밀번호" />
        <input type="password" value={form.passwordConfirm} onChange={(event) => setForm({ ...form, passwordConfirm: event.target.value })} placeholder="비밀번호 확인" />
      </div>
      <button className="primary" disabled={loading} type="submit"><UserPlus size={17} /> 가입 신청</button>
    </form>
  );
}

function PwRequestForm({ submitPwRequest, loading }) {
  const [form, setForm] = useState({ name: "", phone: "", message: "" });
  return (
    <form className="form" onSubmit={(event) => { event.preventDefault(); submitPwRequest(form); }}>
      <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="이름" />
      <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="전화번호" />
      <textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="관리자에게 전달할 메시지" />
      <button className="primary" disabled={loading} type="submit"><KeyRound size={17} /> 비밀번호 요청</button>
    </form>
  );
}

function HomePage({ user, data, isAdmin, canAdmin, refresh, loading }) {
  const member = isAdmin ? null : user;
  const records = member ? data.mileageRecords.filter((item) => item.memberId === member.id).sort(sortNewest) : [];
  const summary = member ? mileageSummary(member.id, data.mileageRecords) : totalMileageSummary(data.mileageRecords);
  return (
    <div className="stack">
      <section className="hero">
        <img src="/assets/kswa-main.png" alt="한국사회복지행정학회" />
        <div>
          <p>Academy of Korean Social Welfare Administration</p>
          <h1>Smile</h1>
          <strong>한국사회복지행정학 심사 Mileage</strong>
        </div>
      </section>
      <div className="quick-grid">
        <InfoTile tone="mint" title="심사 마일리지" icon={<FileSpreadsheet />} />
        <InfoTile tone="blue" title="논문 심사 기록" icon={<Edit3 />} />
        <InfoTile tone="peach" title="게재료 대체 사용" icon={<CheckCircle2 />} />
        <InfoTile tone="green" title="회원 마일리지 확인" icon={<Users />} />
      </div>
      <section className="panel">
        <div className="toolbar slim">
          <h2>{isAdmin ? "전체 마일리지 현황" : `${member.name}님의 마일리지`}</h2>
          <button type="button" onClick={refresh}><RefreshCw size={16} /> {loading ? "불러오는 중" : "새로고침"}</button>
        </div>
        <div className="notice">최대 120만 마일리지까지 적립할 수 있음.</div>
        <div className="metrics">
          <Metric label="적립 마일리지" value={won(summary.earned)} />
          <Metric label="사용 마일리지" value={won(summary.used)} />
          <Metric label="현재 마일리지" value={won(summary.balance)} />
        </div>
      </section>
      {!isAdmin && (
        <section className="panel">
          <h2><BarChart3 size={19} /> 내 기록</h2>
          <RecordList records={records} />
        </section>
      )}
      {canAdmin && <AdminSummary data={data} />}
    </div>
  );
}

function InfoTile({ tone, title, icon }) {
  return (
    <article className={`info-tile ${tone}`}>
      {icon}
      <strong>{title}</strong>
    </article>
  );
}

function Metric({ label, value }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function RecordList({ records }) {
  if (records.length === 0) return <p className="empty">마일리지 기록이 없습니다.</p>;
  return (
    <div className="cards">
      {records.map((record) => (
        <article className="post" key={record.id}>
          <strong>{recordText(record)}</strong>
          {record.note && <p>{record.note}</p>}
          <small>{formatDateTime(record.createdAt)} · {record.editorName}</small>
        </article>
      ))}
    </div>
  );
}

function AdminSummary({ data }) {
  const total = totalMileageSummary(data.mileageRecords);
  return (
    <section className="panel">
      <h2><ShieldCheck size={19} /> 운영 요약</h2>
      <div className="metrics">
        <Metric label="회원" value={`${data.members.length}명`} />
        <Metric label="가입 대기" value={`${data.signupRequests.filter((item) => item.status === "pending").length}건`} />
        <Metric label="비번 요청" value={`${data.pwRequests.filter((item) => item.status === "pending").length}건`} />
        <Metric label="전체 잔여" value={won(total.balance)} />
      </div>
    </section>
  );
}

function MessagesPage({ messages, reads, user, markRead }) {
  return (
    <section className="panel">
      <h2><Mail size={19} /> 쪽지함</h2>
      <div className="cards">
        {messages.length === 0 ? <p className="empty">쪽지가 없습니다.</p> : messages.map((message) => {
          const unread = !isMessageRead(reads, user?.id, message.id);
          return (
            <article className={unread ? "post unread" : "post"} key={message.id} role="button" tabIndex={0} onClick={() => markRead(message)}>
              <div className="post-head">
                <span className="pill">{message.scope === "all" ? "전체" : "개별"}</span>
                {unread && <span className="pill pink">읽지 않음</span>}
              </div>
              <strong>{message.title}</strong>
              <p>{message.content}</p>
              <small>{message.senderName} · {formatDateTime(message.createdAt)}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AdminMessages({ messages, sent, reads, readerId, markRead, deleteMessage }) {
  return (
    <div className="stack">
      <section className="panel">
        <h2><Bell size={19} /> 관리자 수신 쪽지</h2>
        <div className="cards">
          {messages.length === 0 ? <p className="empty">수신 쪽지가 없습니다.</p> : messages.map((message) => {
            const unread = !isMessageRead(reads, readerId, message.id);
            return (
              <article className={unread ? "post unread" : "post"} key={message.id} onClick={() => markRead(message)}>
                <div className="post-head">
                  <span className="pill pink">{message.scope === "pwRequest" ? "비번 요청" : "수신"}</span>
                  {unread && <span className="pill">읽지 않음</span>}
                </div>
                <strong>{message.title}</strong>
                <p>{message.content}</p>
                <footer>
                  <span>{message.senderName} · {formatDateTime(message.createdAt)}</span>
                  <button type="button" onClick={(event) => { event.stopPropagation(); deleteMessage(message); }}><Trash2 size={15} /> 삭제</button>
                </footer>
              </article>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <h2><Mail size={19} /> 발송 내역</h2>
        <div className="cards">
          {sent.length === 0 ? <p className="empty">발송 내역이 없습니다.</p> : sent.sort(sortNewest).map((message) => (
            <article className="post" key={message.id}>
              <strong>{message.title}</strong>
              <p>{message.content}</p>
              <footer>
                <span>{message.recipientName} · {formatDateTime(message.createdAt)}</span>
                <button type="button" onClick={() => deleteMessage(message)}><Trash2 size={15} /> 삭제</button>
              </footer>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AdminPage(props) {
  const { data, tab, setTab, isAdmin, loading, exportExcel, refresh } = props;
  return (
    <div className="stack">
      <section className="toolbar">
        <h1>관리자 패널</h1>
        <div className="toolbar-actions">
          <button className="primary" disabled={loading} type="button" onClick={exportExcel}><Download size={16} /> 엑셀 다운로드</button>
          <button type="button" onClick={refresh}><RefreshCw size={16} /> 새로고침</button>
        </div>
      </section>
      <div className="tabs">
        <button className={tab === "mileage" ? "active" : ""} type="button" onClick={() => setTab("mileage")}>마일리지</button>
        <button className={tab === "members" ? "active" : ""} type="button" onClick={() => setTab("members")}>회원</button>
        {isAdmin && <button className={tab === "signup" ? "active" : ""} type="button" onClick={() => setTab("signup")}>가입 승인</button>}
        <button className={tab === "messages" ? "active" : ""} type="button" onClick={() => setTab("messages")}>쪽지 발송</button>
        <button className={tab === "pw" ? "active" : ""} type="button" onClick={() => setTab("pw")}>비번 요청</button>
      </div>
      {tab === "mileage" && <MileageAdmin {...props} />}
      {tab === "members" && <MembersAdmin {...props} />}
      {tab === "signup" && isAdmin && <SignupAdmin {...props} />}
      {tab === "messages" && <MessageComposer {...props} />}
      {tab === "pw" && <PwAdmin {...props} />}
      <section className="panel muted-panel">
        <strong>Firebase 다운로드 절감 구조</strong>
        <p>이 앱은 자동 반복 전체 다운로드를 하지 않습니다. 첨부파일을 Firebase Realtime Database에 base64로 저장하지 않고, 관리자·부관리자의 수동 새로고침과 작업 시점에만 데이터를 가져옵니다.</p>
      </section>
    </div>
  );
}

function MileageAdmin({ data, saveMileage, deleteMileage }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ memberId: data.members[0]?.id || "", type: "earn", amount: REVIEW_MILEAGE, volume: "", issue: "", note: "" });
  const selected = data.members.find((member) => member.id === form.memberId);
  const summary = selected ? mileageSummary(selected.id, data.mileageRecords) : null;

  function edit(record) {
    setEditing(record);
    setForm({
      memberId: record.memberId,
      type: record.type,
      amount: record.amount,
      volume: record.volume || "",
      issue: record.issue || "",
      note: record.note || "",
    });
  }

  function reset() {
    setEditing(null);
    setForm({ memberId: data.members[0]?.id || "", type: "earn", amount: REVIEW_MILEAGE, volume: "", issue: "", note: "" });
  }

  return (
    <section className="panel">
      <h2><Plus size={19} /> 마일리지 입력</h2>
      <form className="form" onSubmit={async (event) => { event.preventDefault(); await saveMileage(form, editing); reset(); }}>
        <div className="two">
          <select value={form.memberId} onChange={(event) => setForm({ ...form, memberId: event.target.value })}>
            {data.members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)} · {member.affiliation} · {member.phone}</option>)}
          </select>
          <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value, amount: event.target.value === "earn" ? REVIEW_MILEAGE : "" })}>
            <option value="earn">적립 30,000</option>
            <option value="use">사용</option>
            <option value="deduct">차감/취소</option>
          </select>
        </div>
        {selected && <div className="notice">선택 심사자: {selected.name} · {selected.affiliation} · {selected.phone} · 현재 {won(summary.balance)}</div>}
        <div className="three">
          <input value={form.volume} onChange={(event) => setForm({ ...form, volume: event.target.value })} placeholder="권 예: 10" />
          <input value={form.issue} onChange={(event) => setForm({ ...form, issue: event.target.value })} placeholder="호 예: 3" />
          <input disabled={form.type === "earn"} value={form.type === "earn" ? REVIEW_MILEAGE : form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value.replace(/\D/g, "") })} placeholder="마일리지" />
        </div>
        <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="메모" />
        <div className="actions">
          {editing && <button type="button" onClick={reset}>취소</button>}
          <button className="primary" type="submit"><Save size={16} /> {editing ? "수정 저장" : "기록 저장"}</button>
        </div>
      </form>
      <div className="cards">
        {data.mileageRecords.length === 0 ? <p className="empty">마일리지 기록이 없습니다.</p> : data.mileageRecords.map((record) => (
          <article className="post" key={record.id}>
            <strong>{record.memberName} · {recordText(record)}</strong>
            <p>{record.memberAffiliation} · {record.memberPhone}</p>
            <footer>
              <span>{formatDateTime(record.createdAt)} · {record.editorName}</span>
              <span className="post-actions">
                <button type="button" onClick={() => edit(record)}><Edit3 size={15} /> 수정</button>
                <button type="button" onClick={() => deleteMileage(record)}><Trash2 size={15} /> 삭제</button>
              </span>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}

function MembersAdmin({ data, isAdmin, toggleSubAdmin, forceWithdraw }) {
  const subCount = data.members.filter(isSubAdminMember).length;
  return (
    <section className="panel">
      <h2><Users size={19} /> 회원 관리</h2>
      <div className="notice">부관리자는 최대 4명까지 지정할 수 있습니다. 현재 {subCount}/4명</div>
      <div className="cards">
        {data.members.map((member) => {
          const summary = mileageSummary(member.id, data.mileageRecords);
          return (
            <article className="post member-row" key={member.id}>
              <div>
                <strong>{memberLabel(member)} {isSubAdminMember(member) && <span className="submark"><Crown size={13} /> 부관리자</span>}</strong>
                <p>{member.affiliation} · {member.phone}</p>
                <small>현재 {won(summary.balance)} · 적립 {won(summary.earned)} · 사용 {won(summary.used)}</small>
              </div>
              {isAdmin && (
                <span className="post-actions">
                  <button className={isSubAdminMember(member) ? "primary" : ""} type="button" onClick={() => toggleSubAdmin(member)}><Crown size={15} /> {isSubAdminMember(member) ? "해제" : "부관리자"}</button>
                  <button type="button" onClick={() => forceWithdraw(member)}><Trash2 size={15} /> 강제 탈퇴</button>
                </span>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SignupAdmin({ data, approveSignup, rejectSignup }) {
  const requests = data.signupRequests.sort(sortNewest);
  return (
    <section className="panel">
      <h2><UserPlus size={19} /> 가입 승인</h2>
      <div className="cards">
        {requests.length === 0 ? <p className="empty">가입 신청이 없습니다.</p> : requests.map((req) => (
          <article className="post member-row" key={req.id}>
            <div>
              <strong>{req.name} · {statusText(req.status)}</strong>
              <p>{req.affiliation} · {req.phone}</p>
              <small>{formatDateTime(req.requestedAt)}</small>
            </div>
            {req.status === "pending" && (
              <span className="post-actions">
                <button className="primary" type="button" onClick={() => approveSignup(req)}>승인</button>
                <button type="button" onClick={() => rejectSignup(req)}>거부</button>
              </span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function MessageComposer({ data, sendMessage }) {
  const [form, setForm] = useState({ recipientId: "all", title: "", content: "" });
  return (
    <section className="panel">
      <h2><Mail size={19} /> 쪽지 발송</h2>
      <form className="form" onSubmit={async (event) => { event.preventDefault(); await sendMessage(form); setForm({ recipientId: "all", title: "", content: "" }); }}>
        <div className="two">
          <select value={form.recipientId} onChange={(event) => setForm({ ...form, recipientId: event.target.value })}>
            <option value="all">전체 회원</option>
            {data.members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}
          </select>
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="쪽지 제목" />
        </div>
        <textarea value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} placeholder="쪽지 내용" />
        <button className="primary" type="submit">쪽지 보내기</button>
      </form>
    </section>
  );
}

function PwAdmin({ data, resolvePwRequest }) {
  return (
    <section className="panel">
      <h2><KeyRound size={19} /> 비밀번호 요청</h2>
      <div className="cards">
        {data.pwRequests.length === 0 ? <p className="empty">비밀번호 요청이 없습니다.</p> : data.pwRequests.sort(sortNewest).map((req) => {
          const member = findPwMember(req, data.members);
          const password = member?.password || req.resolvedPassword || "확인 불가";
          return (
            <article className="post" key={req.id}>
              <strong>{req.name} · {statusText(req.status)}</strong>
              <p>전화번호: {req.phone}</p>
              <p>관리자 확인 비밀번호: <strong>{password}</strong></p>
              {req.message && <p>요청 메시지: {req.message}</p>}
              <footer>
                <span>{formatDateTime(req.createdAt)}</span>
                {req.status === "pending" && <button className="primary" type="button" onClick={() => resolvePwRequest(req)}>처리 완료</button>}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

async function fetchRemoteData() {
  const [members, signupRequests, mileageRecords, messages, messageReads, pwRequests, withdrawals] = await Promise.all([
    fbGet("members"),
    fbGet("signupRequests"),
    fbGet("mileageRecords"),
    fbGet("messages"),
    fbGet("messageReads"),
    fbGet("pwRequests"),
    fbGet("withdrawals"),
  ]);
  return {
    members: toArray(members).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko")),
    signupRequests: toArray(signupRequests).sort(sortNewest),
    mileageRecords: toArray(mileageRecords).sort(sortNewest),
    messages: toArray(messages).sort(sortNewest),
    messageReads: toArray(messageReads, "key"),
    pwRequests: toArray(pwRequests).sort(sortNewest),
    withdrawals: toArray(withdrawals).sort(sortNewest),
  };
}

async function fbGet(path) {
  const response = await fetch(`${DB}/${path}.json`);
  if (!response.ok) throw new Error(`GET ${path} failed`);
  const data = await response.json();
  return data === null ? undefined : data;
}

async function fbPatch(path, value) {
  const response = await fetch(`${DB}/${path}.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`PATCH ${path} failed`);
}

async function fbDelete(path) {
  const response = await fetch(`${DB}/${path}.json`, { method: "DELETE" });
  if (!response.ok) throw new Error(`DELETE ${path} failed`);
}

function readLocalData() {
  return { ...EMPTY_DATA, ...readStorage(STORAGE.data, {}) };
}

function readStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  if (value === null || value === undefined || value === false) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function toArray(value, idField = "id") {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return Object.entries(value).map(([key, item]) => ({ ...item, [idField]: item[idField] || key, _fbKey: key }));
}

function cleanFirebase(value) {
  if (Array.isArray(value)) return value.map(cleanFirebase);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "_fbKey").map(([key, entry]) => [key, cleanFirebase(entry)]));
}

function firebaseKey(value) {
  return String(value).replace(/[.$#[\]/]/g, "_");
}

function firebaseRecordKey(record, fallback) {
  return firebaseKey(record?._fbKey || record?.id || record?.key || fallback);
}

function upsertById(items, item) {
  return items.some((entry) => entry.id === item.id) ? items.map((entry) => entry.id === item.id ? item : entry) : [item, ...items];
}

function upsertByKey(items, item, keyField) {
  return items.some((entry) => entry[keyField] === item[keyField]) ? items.map((entry) => entry[keyField] === item[keyField] ? item : entry) : [item, ...items];
}

function getVisibleMessages(messages, user, isAdmin) {
  if (!user || isAdmin) return [];
  return messages.filter((item) => item.recipientId === "all" || item.recipientId === user.id).sort(sortNewest);
}

function isMessageRead(reads, memberId, messageId) {
  return reads.some((item) => item.key === `${memberId}_${messageId}` || (item.memberId === memberId && item.messageId === messageId));
}

function isSubAdminMember(member) {
  return member?.role === "subAdmin";
}

function findPwMember(req, members) {
  if (req.memberId) {
    const byId = members.find((item) => item.id === req.memberId);
    if (byId) return byId;
  }
  return pickLatest(members.filter((item) => item.name === req.name && item.phone === req.phone));
}

function buildPwAdminMessage(req, member) {
  const password = member?.password || req.resolvedPassword || "확인 불가";
  return {
    id: makeId("message"),
    recipientId: "admin",
    recipientName: "관리자",
    scope: "pwRequest",
    title: `비밀번호 요청: ${req.name}`,
    content: [`${req.name}님의 비밀번호 요청입니다.`, `전화번호: ${req.phone}`, `현재 비밀번호: ${password}`, req.message ? `요청 메시지: ${req.message}` : ""].filter(Boolean).join("\n"),
    senderId: "system",
    senderName: "비밀번호 요청 시스템",
    relatedPwRequestId: req.id,
    createdAt: req.createdAt,
  };
}

function mileageSummary(memberId, records) {
  return records.filter((item) => item.memberId === memberId).reduce((sum, item) => {
    if (item.type === "earn") sum.earned += Number(item.amount || 0);
    if (item.type === "use") sum.used += Number(item.amount || 0);
    if (item.type === "deduct") sum.deducted += Number(item.amount || 0);
    sum.balance = sum.earned - sum.used - sum.deducted;
    return sum;
  }, { earned: 0, used: 0, deducted: 0, balance: 0 });
}

function totalMileageSummary(records) {
  return records.reduce((sum, item) => {
    if (item.type === "earn") sum.earned += Number(item.amount || 0);
    if (item.type === "use") sum.used += Number(item.amount || 0);
    if (item.type === "deduct") sum.deducted += Number(item.amount || 0);
    sum.balance = sum.earned - sum.used - sum.deducted;
    return sum;
  }, { earned: 0, used: 0, deducted: 0, balance: 0 });
}

function recordText(record) {
  const issue = record.volume || record.issue ? `(${record.volume || "-"}권 ${record.issue || "-"}호)` : "";
  if (record.type === "earn") return `적립 ${won(record.amount)} 마일리지 ${issue}`;
  if (record.type === "use") return `사용 ${won(record.amount)} 마일리지 ${issue}`;
  return `차감 ${won(record.amount)} 마일리지 ${issue}`;
}

function memberLabel(member) {
  return `${member.name}(${member.affiliation || "소속 없음"})`;
}

function won(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function statusText(status) {
  if (status === "approved") return "승인";
  if (status === "rejected") return "거부";
  if (status === "done") return "완료";
  return "대기";
}

function sortNewest(a, b) {
  return recordTime(b) - recordTime(a);
}

function recordTime(record) {
  return Date.parse(record?.updatedAt || record?.createdAt || record?.requestedAt || record?.reviewedAt || record?.joinedAt || record?.withdrawnAt || "") || 0;
}

function pickLatest(items) {
  return items.sort(sortNewest)[0] || null;
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function now() {
  return new Date().toISOString();
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function downloadExcel(data) {
  const sheets = [
    { name: "회원", columns: ["이름", "소속", "전화번호", "권한", "비밀번호", "가입일"], rows: data.members.map((m) => [m.name, m.affiliation, m.phone, isSubAdminMember(m) ? "부관리자" : "회원", m.password, formatDateTime(m.joinedAt)]) },
    { name: "마일리지", columns: ["회원", "소속", "전화번호", "구분", "금액", "권", "호", "메모", "입력자", "일시"], rows: data.mileageRecords.map((r) => [r.memberName, r.memberAffiliation, r.memberPhone, r.type, r.amount, r.volume, r.issue, r.note, r.editorName, formatDateTime(r.createdAt)]) },
    { name: "쪽지", columns: ["제목", "내용", "발신", "수신", "구분", "일시"], rows: data.messages.map((m) => [m.title, m.content, m.senderName, m.recipientName, m.scope, formatDateTime(m.createdAt)]) },
    { name: "비번요청", columns: ["이름", "전화번호", "비밀번호", "상태", "메시지", "일시"], rows: data.pwRequests.map((r) => [r.name, r.phone, findPwMember(r, data.members)?.password || r.resolvedPassword, r.status, r.message, formatDateTime(r.createdAt)]) },
    { name: "가입신청", columns: ["이름", "소속", "전화번호", "상태", "신청일"], rows: data.signupRequests.map((r) => [r.name, r.affiliation, r.phone, r.status, formatDateTime(r.requestedAt)]) },
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.map(sheetXml).join("")}</Workbook>`;
  const blob = new Blob(["\ufeff", xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `smile-mileage-data-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sheetXml(sheet) {
  const header = `<Row>${sheet.columns.map(cellXml).join("")}</Row>`;
  const rows = sheet.rows.map((row) => `<Row>${row.map(cellXml).join("")}</Row>`).join("");
  return `<Worksheet ss:Name="${escapeXml(sheet.name)}"><Table>${header}${rows}</Table></Worksheet>`;
}

function cellXml(value) {
  return `<Cell><Data ss:Type="String">${escapeXml(value ?? "")}</Data></Cell>`;
}

function escapeXml(value) {
  return String(value).replace(/[\u0000-\u001F]/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

createRoot(document.getElementById("root")).render(<App />);
