import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  CheckCircle2,
  Crown,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  LogOut,
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

const PROJECT_ID = "smile-of-kswa";
const CONFIGURED_DB = import.meta.env.VITE_FIREBASE_DB_URL?.replace(/\/$/, "");
const DB_CANDIDATES = [
  CONFIGURED_DB,
  `https://${PROJECT_ID}.firebaseio.com`,
  `https://${PROJECT_ID}-default-rtdb.firebaseio.com`,
  `https://${PROJECT_ID}-default-rtdb.asia-southeast1.firebasedatabase.app`,
  `https://${PROJECT_ID}-default-rtdb.europe-west1.firebasedatabase.app`,
].filter(Boolean);
const ADMIN_ID = "kswa1997";
const ADMIN_PW = "love1004";
const REVIEW_MILEAGE = 30000;
const MAX_MILEAGE = 1200000;
const MIN_USE_MILEAGE = 100000;
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8}$/;

const STORAGE = {
  user: "smile_user",
  admin: "smile_admin",
  data: "smile_data",
};

const EMPTY_DATA = {
  members: [],
  signupRequests: [],
  mileageRecords: [],
  pwRequests: [],
  usageRequests: [],
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
  const pendingSignupCount = isAdmin ? data.signupRequests.filter((item) => item.status === "pending").length : 0;
  const pendingPwCount = data.pwRequests.filter((item) => item.status === "pending").length;
  const pendingUsageCount = data.usageRequests.filter((item) => item.status === "pending").length;

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
      setError("이름과 비밀번호를 입력해주세요. 비밀번호는 영어와 숫자를 혼용한 8자리입니다.");
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
      setError("비밀번호는 영어와 숫자를 혼용한 8자리입니다. 예: a1234567");
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

  async function fetchSignupContext() {
    const [membersResult, signupResult] = await Promise.allSettled([fbGet("members"), fbGet("signupRequests")]);
    return {
      ...dataRef.current,
      members: membersResult.status === "fulfilled" ? toArray(membersResult.value).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko")) : dataRef.current.members,
      signupRequests: signupResult.status === "fulfilled" ? toArray(signupResult.value).sort(sortNewest) : dataRef.current.signupRequests,
    };
  }

  async function register(form) {
    clearAlerts();
    const trimmed = {
      name: form.name.trim(),
      affiliation: form.affiliation.trim(),
      phone: form.phone.trim(),
      password: form.password.trim(),
    };
    if (!trimmed.name || !trimmed.affiliation || !trimmed.phone) {
      setError("이름, 소속, 전화번호를 모두 입력해주세요.");
      return;
    }
    if (!PASSWORD_RULE.test(trimmed.password)) {
      setError("비밀번호는 영어와 숫자를 혼용한 8자리입니다. 예: a1234567");
      return;
    }
    if (trimmed.password !== form.passwordConfirm.trim()) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setLoading(true);
    try {
      const remote = await fetchSignupContext();
      const duplicateMember = remote.members.some((item) => item.name === trimmed.name && item.phone === trimmed.phone);
      const duplicateRequest = remote.signupRequests.some((item) => item.status === "pending" && item.name === trimmed.name && item.phone === trimmed.phone);
      if (duplicateMember || duplicateRequest) {
        setError("이미 등록되었거나 승인 대기 중인 가입 신청이 있습니다.");
        return;
      }
      const request = {
        id: makeId("signup"),
        name: trimmed.name,
        affiliation: trimmed.affiliation,
        phone: trimmed.phone,
        password: trimmed.password,
        status: "pending",
        requestedAt: now(),
      };
      await fbPut(`signupRequests/${firebaseKey(request.id)}`, cleanFirebase(request));
      updateData({ ...remote, signupRequests: [request, ...remote.signupRequests] });
      setAuthMode("login");
      setMessage("가입신청이 정상적으로 접수되었습니다. 관리자에게 가입을 요청했습니다.");
    } catch (err) {
      console.error(err);
      setError(firebaseErrorText(err, "가입신청"));
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
      await fbPatch("pwRequests", { [firebaseKey(req.id)]: cleanFirebase(req) });
      updateData({
        ...remote,
        pwRequests: [req, ...remote.pwRequests],
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
      paperTitle: form.paperTitle.trim(),
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

  async function submitUsageRequest(form) {
    clearAlerts();
    if (isAdmin || !sessionUser?.id) return false;
    const amount = Number(String(form.amount || "").replace(/\D/g, ""));
    if (!Number.isFinite(amount) || amount < MIN_USE_MILEAGE) {
      setError("마일리지는 10만 마일리지부터 사용이 가능합니다.");
      return false;
    }
    const summary = mileageSummary(sessionUser.id, dataRef.current.mileageRecords);
    if (amount > summary.balance) {
      setError("현재 보유 마일리지보다 큰 금액은 요청할 수 없습니다.");
      return false;
    }
    setLoading(true);
    try {
      const item = {
        id: makeId("usage"),
        memberId: sessionUser.id,
        memberName: sessionUser.name,
        memberAffiliation: sessionUser.affiliation,
        memberPhone: sessionUser.phone,
        amount,
        note: form.note.trim(),
        status: "pending",
        createdAt: now(),
      };
      await fbPut(`usageRequests/${firebaseKey(item.id)}`, cleanFirebase(item));
      updateData({ ...dataRef.current, usageRequests: [item, ...dataRef.current.usageRequests] });
      setMessage("마일리지 사용 요청이 관리자에게 전달되었습니다.");
      return true;
    } catch (err) {
      console.error(err);
      setError(firebaseErrorText(err, "마일리지 사용 요청"));
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function approveUsageRequest(req) {
    if (!canAdmin || req.status !== "pending") return;
    clearAlerts();
    setLoading(true);
    try {
      const member = dataRef.current.members.find((item) => item.id === req.memberId);
      if (!member) throw new Error("회원 정보를 찾을 수 없습니다.");
      const summary = mileageSummary(member.id, dataRef.current.mileageRecords);
      if (Number(req.amount || 0) > summary.balance) {
        throw new Error("현재 잔여 마일리지보다 큰 요청입니다.");
      }
      const approved = {
        ...req,
        status: "approved",
        reviewedAt: now(),
        reviewedBy: isAdmin ? "관리자" : `${sessionUser.name} 부관리자`,
      };
      const record = {
        id: makeId("mileage"),
        memberId: member.id,
        memberName: member.name,
        memberAffiliation: member.affiliation,
        memberPhone: member.phone,
      type: "use",
      amount: Number(req.amount || 0),
      volume: "",
      issue: "",
      paperTitle: "",
      note: req.note ? `사용 요청 승인: ${req.note}` : "사용 요청 승인",
        relatedUsageRequestId: req.id,
        updatedAt: now(),
        createdAt: now(),
        editorId: isAdmin ? "admin" : sessionUser.id,
        editorName: isAdmin ? "관리자" : sessionUser.name,
      };
      await fbPatch("usageRequests", { [firebaseRecordKey(req, req.id)]: cleanFirebase(approved) });
      await fbPatch("mileageRecords", { [firebaseKey(record.id)]: cleanFirebase(record) });
      updateData({
        ...dataRef.current,
        usageRequests: upsertById(dataRef.current.usageRequests, approved).sort(sortNewest),
        mileageRecords: upsertById(dataRef.current.mileageRecords, record).sort(sortNewest),
      });
      setMessage("마일리지 사용 요청을 승인하고 사용 기록을 등록했습니다.");
    } catch (err) {
      console.error(err);
      setError(err?.status ? firebaseErrorText(err, "마일리지 사용 요청 승인") : err?.message || "마일리지 사용 요청 승인 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function rejectUsageRequest(req) {
    if (!canAdmin || req.status !== "pending") return;
    clearAlerts();
    setLoading(true);
    try {
      const rejected = {
        ...req,
        status: "rejected",
        reviewedAt: now(),
        reviewedBy: isAdmin ? "관리자" : `${sessionUser.name} 부관리자`,
      };
      await fbPatch("usageRequests", { [firebaseRecordKey(req, req.id)]: cleanFirebase(rejected) });
      updateData({ ...dataRef.current, usageRequests: upsertById(dataRef.current.usageRequests, rejected).sort(sortNewest) });
      setMessage("마일리지 사용 요청을 거부했습니다.");
    } catch (err) {
      console.error(err);
      setError(firebaseErrorText(err, "마일리지 사용 요청 거부"));
    } finally {
      setLoading(false);
    }
  }

  async function updateProfile(form) {
    clearAlerts();
    if (isAdmin || !sessionUser?.id) return;
    const affiliation = form.affiliation.trim();
    const phone = form.phone.trim();
    const password = form.password.trim();
    const passwordConfirm = form.passwordConfirm.trim();
    if (!affiliation || !phone) {
      setError("소속과 전화번호를 모두 입력해주세요.");
      return;
    }
    if (password || passwordConfirm) {
      if (!PASSWORD_RULE.test(password)) {
        setError("새 비밀번호는 영어와 숫자를 혼용한 8자리입니다. 예: a1234567");
        return;
      }
      if (password !== passwordConfirm) {
        setError("새 비밀번호 확인이 일치하지 않습니다.");
        return;
      }
    }
    setLoading(true);
    try {
      const updated = {
        ...sessionUser,
        affiliation,
        phone,
        password: password || sessionUser.password,
        updatedAt: now(),
      };
      await fbPatch("members", { [firebaseRecordKey(sessionUser, sessionUser.id)]: cleanFirebase(updated) });
      updateData({ ...dataRef.current, members: upsertById(dataRef.current.members, updated) });
      setUser(updated);
      writeStorage(STORAGE.user, updated);
      setMessage("개인정보가 수정되었습니다.");
      setPage("home");
    } catch (err) {
      console.error(err);
      setError(firebaseErrorText(err, "개인정보 수정"));
    } finally {
      setLoading(false);
    }
  }

  async function resolvePwRequest(req) {
    if (!canAdmin) return;
    const updated = { ...req, status: "done", resolvedAt: now() };
    await fbPatch("pwRequests", { [firebaseRecordKey(req, req.id)]: cleanFirebase(updated) });
    updateData({ ...dataRef.current, pwRequests: upsertById(dataRef.current.pwRequests, updated) });
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
    clearAlerts();
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
          <span>Smile of KSWA</span>
          <strong>심사 Mileage</strong>
        </button>
        <nav>
          <button className={page === "home" ? "active" : ""} type="button" onClick={() => setPage("home")}><BarChart3 size={17} /> 홈</button>
          {!isAdmin && <button className={page === "profile" ? "active" : ""} type="button" onClick={() => setPage("profile")}><User size={17} /> 개인정보</button>}
          {canAdmin && <button className={page === "admin" ? "active" : ""} type="button" onClick={() => setPage("admin")}><ShieldCheck size={17} /> 관리자<CountBadge count={pendingSignupCount + pendingPwCount + pendingUsageCount} /></button>}
        </nav>
        <div className="session">
          <span>{isAdmin ? <><Crown className="admin-crown" size={24} /> 관리자</> : <>{sessionUser?.name}{isSubAdmin && <small><Crown size={13} /> 부관리자</small>}</>}</span>
          <button type="button" onClick={logout}><LogOut size={16} /> 로그아웃</button>
        </div>
      </header>

      {(message || error) && <div className={error ? "alert error" : "alert"}>{error || message}</div>}

      {page === "home" && <HomePage user={sessionUser} data={data} isAdmin={isAdmin} canAdmin={canAdmin} refresh={() => refreshData()} loading={loading} submitUsageRequest={submitUsageRequest} />}
      {page === "profile" && !isAdmin && <ProfilePage user={sessionUser} updateProfile={updateProfile} loading={loading} />}
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
          approveUsageRequest={approveUsageRequest}
          rejectUsageRequest={rejectUsageRequest}
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
        <h1>Smile of KSWA</h1>
        <p>한국사회복지행정학 심사 Mileage</p>
        <p className="contact-note">학회 마일리지와 웹 운영에 관한 질문과 요청은 학회(편집간사)에 연락을 주시기를 바랍니다(www.koweladmin.or.kr).</p>
        <div className="notice">비밀번호는 <strong>영어와 숫자를 혼용한 8자리</strong>입니다. 예: <strong>a1234567</strong></div>
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

function CountBadge({ count }) {
  return count > 0 ? <span className="count-badge">{count}</span> : null;
}

function LoginForm({ login, loading }) {
  const [form, setForm] = useState({ name: "", password: "" });
  return (
    <form className="form" onSubmit={(event) => { event.preventDefault(); login(form); }}>
      <label>이름 또는 관리자 ID<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="이름 입력" /></label>
      <PasswordField label="비밀번호" value={form.password} onChange={(value) => setForm({ ...form, password: value })} placeholder="영어+숫자 혼용 8자리 예: a1234567" />
      <button className="primary" disabled={loading} type="submit">로그인</button>
    </form>
  );
}

function PasswordField({ label, value, onChange, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      {label}
      <span className="password-field">
        <input type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        <button aria-label={visible ? `${label} 숨기기` : `${label} 보기`} type="button" onClick={() => setVisible((next) => !next)}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  );
}

function RegisterForm({ register, loading }) {
  const [form, setForm] = useState({ name: "", affiliation: "", phone: "", password: "", passwordConfirm: "" });
  return (
    <form className="form" onSubmit={(event) => { event.preventDefault(); register(form); }}>
      <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="이름" />
      <input value={form.affiliation} onChange={(event) => setForm({ ...form, affiliation: event.target.value })} placeholder="소속" />
      <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="전화번호" />
      <div className="notice">비밀번호는 영어와 숫자를 혼용한 8자리입니다. 예: a1234567, 1234567b, abcdefg0</div>
      <div className="two">
        <PasswordField label="비밀번호" value={form.password} onChange={(value) => setForm({ ...form, password: value })} placeholder="비밀번호" />
        <PasswordField label="비밀번호 확인" value={form.passwordConfirm} onChange={(value) => setForm({ ...form, passwordConfirm: value })} placeholder="비밀번호 확인" />
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

function ProfilePage({ user, updateProfile, loading }) {
  const [form, setForm] = useState({
    affiliation: user?.affiliation || "",
    phone: user?.phone || "",
    password: "",
    passwordConfirm: "",
  });
  return (
    <section className="panel profile-panel">
      <h2><User size={19} /> 개인정보</h2>
      <div className="notice">이름은 변경할 수 없습니다. 소속, 전화번호, 비밀번호만 수정할 수 있습니다.</div>
      <form className="form" onSubmit={(event) => { event.preventDefault(); updateProfile(form); }}>
        <label>이름<input value={user?.name || ""} disabled readOnly /></label>
        <div className="two">
          <label>소속<input value={form.affiliation} onChange={(event) => setForm({ ...form, affiliation: event.target.value })} placeholder="소속" /></label>
          <label>전화번호<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="전화번호" /></label>
        </div>
        <div className="notice">비밀번호는 변경할 때만 입력해주세요. 영어와 숫자를 혼용한 8자리입니다.</div>
        <div className="two">
          <PasswordField label="새 비밀번호" value={form.password} onChange={(value) => setForm({ ...form, password: value })} placeholder="새 비밀번호" />
          <PasswordField label="새 비밀번호 확인" value={form.passwordConfirm} onChange={(value) => setForm({ ...form, passwordConfirm: value })} placeholder="새 비밀번호 확인" />
        </div>
        <div className="actions centered-actions">
          <button className="primary" disabled={loading} type="submit"><Save size={16} /> 개인정보 수정</button>
        </div>
      </form>
    </section>
  );
}

function HomePage({ user, data, isAdmin, canAdmin, refresh, loading, submitUsageRequest }) {
  const [section, setSection] = useState("mileage");
  const member = isAdmin ? null : user;
  const records = member ? data.mileageRecords.filter((item) => item.memberId === member.id).sort(sortNewest) : [];
  const summary = member ? mileageSummary(member.id, data.mileageRecords) : totalMileageSummary(data.mileageRecords);
  const usageRequests = member ? data.usageRequests.filter((item) => item.memberId === member.id).sort(sortNewest) : [];
  return (
    <div className="stack">
      <section className="hero">
        <img src="/assets/kswa-main.png" alt="한국사회복지행정학회" />
        <div>
          <p>Academy of Korean Social Welfare Administration</p>
          <h1>Smile of KSWA</h1>
          <strong>한국사회복지행정학 심사 Mileage</strong>
        </div>
      </section>
      {!isAdmin && (
        <div className="quick-grid user-quick-grid">
          <InfoTile active={section === "mileage"} tone="mint" title="심사 마일리지" icon={<FileSpreadsheet />} onClick={() => setSection("mileage")} />
          <InfoTile active={section === "use"} tone="peach" title="게재료 대체 사용" icon={<CheckCircle2 />} onClick={() => setSection("use")} />
          <InfoTile active={section === "summary"} tone="green" title="회원 활동" icon={<Users />} onClick={() => setSection("summary")} />
        </div>
      )}
      {isAdmin && (
        <section className="panel">
          <div className="toolbar slim">
            <h2>전체 마일리지 현황</h2>
            <button type="button" onClick={refresh}><RefreshCw size={16} /> {loading ? "불러오는 중" : "새로고침"}</button>
          </div>
          <div className="notice">최대 120만 마일리지까지 적립할 수 있음.</div>
          <div className="metrics">
            <Metric label="적립 마일리지" value={won(summary.earned)} />
            <Metric label="사용 마일리지" value={won(summary.used)} />
            <Metric label="현재 마일리지" value={won(summary.balance)} />
          </div>
        </section>
      )}
      {!isAdmin && section === "mileage" && <MileageDetail member={member} summary={summary} records={records} refresh={refresh} loading={loading} />}
      {!isAdmin && section === "use" && <UsageRequestPanel summary={summary} requests={usageRequests} submitUsageRequest={submitUsageRequest} loading={loading} />}
      {!isAdmin && section === "summary" && <MemberMileageSummary member={member} summary={summary} records={records} requests={usageRequests} refresh={refresh} loading={loading} />}
      {canAdmin && <AdminSummary data={data} />}
    </div>
  );
}

function InfoTile({ tone, title, icon, active, onClick }) {
  return (
    <button className={`info-tile ${tone}${active ? " active" : ""}`} type="button" onClick={onClick}>
      {icon}
      <strong>{title}</strong>
    </button>
  );
}

function MileageDetail({ member, summary, records, refresh, loading }) {
  const reviewRecords = records.filter((record) => record.type === "earn");
  return (
    <section className="panel">
      <div className="toolbar slim">
        <h2><FileSpreadsheet size={19} /> {member.name}님의 심사 마일리지</h2>
        <button type="button" onClick={refresh}><RefreshCw size={16} /> {loading ? "불러오는 중" : "새로고침"}</button>
      </div>
      <div className="notice">최대 120만 마일리지까지 적립할 수 있음.</div>
      <div className="metrics">
        <Metric label="적립 마일리지" value={won(summary.earned)} />
        <Metric label="사용 마일리지" value={won(summary.used)} />
        <Metric label="차감 마일리지" value={won(summary.deducted)} />
        <Metric label="현재 마일리지" value={won(summary.balance)} />
      </div>
      <div className="detail-grid">
        <div>
          <h3>마일리지 기록</h3>
          <RecordList records={records} />
        </div>
        <div>
          <h3>논문 심사기록</h3>
          <ReviewRecordList records={reviewRecords} />
        </div>
      </div>
    </section>
  );
}

function ReviewRecordList({ records }) {
  if (records.length === 0) return <p className="empty">논문 심사기록이 없습니다.</p>;
  return (
    <div className="cards">
      {records.map((record) => (
        <article className="post" key={record.id}>
          <strong>{record.volume || "-"}권 {record.issue || "-"}호</strong>
          {record.paperTitle && <p>논문 제목: {record.paperTitle}</p>}
          <p>적립 {won(record.amount)} 마일리지</p>
          {record.note && <p>{record.note}</p>}
          <small>{formatDateTime(record.createdAt)} · {record.editorName}</small>
        </article>
      ))}
    </div>
  );
}

function UsageRequestPanel({ summary, requests, submitUsageRequest, loading }) {
  const [form, setForm] = useState({ amount: "", note: "" });
  const [formError, setFormError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setFormError("");
    const amount = Number(String(form.amount || "").replace(/\D/g, ""));
    if (!Number.isFinite(amount) || amount < MIN_USE_MILEAGE) {
      setFormError("마일리지는 10만 마일리지부터 사용이 가능합니다.");
      return;
    }
    if (amount > summary.balance) {
      setFormError("현재 보유 마일리지보다 큰 금액은 요청할 수 없습니다.");
      return;
    }
    const ok = await submitUsageRequest(form);
    if (ok) setForm({ amount: "", note: "" });
  }
  return (
    <section className="panel">
      <h2><CheckCircle2 size={19} /> 게재료 대체 사용 요청</h2>
      <form className="form" onSubmit={submit}>
        <input inputMode="numeric" value={form.amount} onChange={(event) => { setForm({ ...form, amount: formatMileageInput(event.target.value) }); setFormError(""); }} placeholder="사용 마일리지 예: 120,000" />
        <div className={formError ? "alert error field-alert" : "notice field-alert"}>{formError || `마일리지는 10만 마일리지부터 사용이 가능합니다. 현재 사용 가능 마일리지: ${won(summary.balance)}`}</div>
        <textarea maxLength={500} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="관리자에게 전달할 사용 요청 내용(사용할 권이나 호수, 혹은 현재 게재를 원하는 논문명을 적어주세요)" />
        <small className="char-count">{form.note.length}/500자</small>
        <button className="primary" disabled={loading} type="submit">사용 요청</button>
      </form>
      <h3>내 사용 요청 내역</h3>
      <UsageRequestList requests={requests} />
    </section>
  );
}

function UsageRequestList({ requests, showMember = false, actions }) {
  if (requests.length === 0) return <p className="empty">마일리지 사용 요청이 없습니다.</p>;
  return (
    <div className="cards">
      {requests.map((request) => (
        <article className="post member-row" key={request.id}>
          <div>
            <strong>{showMember ? `${request.memberName} · ` : ""}{won(request.amount)} 마일리지 · {statusText(request.status)}</strong>
            {showMember && <p>{request.memberAffiliation} · {request.memberPhone}</p>}
            {request.note && <p>{request.note}</p>}
            <small>{formatDateTime(request.createdAt)}{request.reviewedAt ? ` · 처리 ${formatDateTime(request.reviewedAt)}` : ""}</small>
          </div>
          {actions && request.status === "pending" && <span className="post-actions">{actions(request)}</span>}
        </article>
      ))}
    </div>
  );
}

function MemberMileageSummary({ member, summary, records, requests, refresh, loading }) {
  return (
    <section className="panel">
      <div className="toolbar slim">
        <h2><Users size={19} /> {member.name}님의 회원 활동</h2>
        <button type="button" onClick={refresh}><RefreshCw size={16} /> {loading ? "불러오는 중" : "새로고침"}</button>
      </div>
      <div className="metrics">
        <Metric label="총 적립" value={won(summary.earned)} />
        <Metric label="총 사용" value={won(summary.used)} />
        <Metric label="총 차감" value={won(summary.deducted)} />
        <Metric label="현재 잔여" value={won(summary.balance)} />
      </div>
      <div className="metrics">
        <Metric label="전체 기록" value={`${records.length}건`} />
        <Metric label="심사 기록" value={`${records.filter((record) => record.type === "earn").length}건`} />
        <Metric label="사용 요청" value={`${requests.length}건`} />
        <Metric label="승인 사용" value={`${requests.filter((request) => request.status === "approved").length}건`} />
      </div>
    </section>
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
          {record.paperTitle && <p>논문 제목: {record.paperTitle}</p>}
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
        <Metric label="사용 요청" value={`${data.usageRequests.filter((item) => item.status === "pending").length}건`} />
        <Metric label="비번 요청" value={`${data.pwRequests.filter((item) => item.status === "pending").length}건`} />
        <Metric label="전체 잔여" value={won(total.balance)} />
      </div>
    </section>
  );
}

function AdminPage(props) {
  const { data, tab, setTab, isAdmin, loading, exportExcel, refresh } = props;
  const pendingSignupCount = data.signupRequests.filter((item) => item.status === "pending").length;
  const pendingUsageCount = data.usageRequests.filter((item) => item.status === "pending").length;
  const pendingPwCount = data.pwRequests.filter((item) => item.status === "pending").length;
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
        {isAdmin && <button className={tab === "signup" ? "active" : ""} type="button" onClick={() => setTab("signup")}>가입 승인<CountBadge count={pendingSignupCount} /></button>}
        <button className={tab === "usage" ? "active" : ""} type="button" onClick={() => setTab("usage")}>사용 요청<CountBadge count={pendingUsageCount} /></button>
        <button className={tab === "pw" ? "active" : ""} type="button" onClick={() => setTab("pw")}>비번 요청<CountBadge count={pendingPwCount} /></button>
      </div>
      {tab === "mileage" && <MileageAdmin {...props} />}
      {tab === "members" && <MembersAdmin {...props} />}
      {tab === "signup" && isAdmin && <SignupAdmin {...props} />}
      {tab === "usage" && <UsageRequestsAdmin {...props} />}
      {tab === "pw" && <PwAdmin {...props} />}
    </div>
  );
}

function MileageAdmin({ data, saveMileage, deleteMileage }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ memberId: data.members[0]?.id || "", type: "earn", amount: REVIEW_MILEAGE, volume: "", issue: "", paperTitle: "", note: "" });
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
      paperTitle: record.paperTitle || "",
      note: record.note || "",
    });
  }

  function reset() {
    setEditing(null);
    setForm({ memberId: data.members[0]?.id || "", type: "earn", amount: REVIEW_MILEAGE, volume: "", issue: "", paperTitle: "", note: "" });
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
        <input value={form.paperTitle} onChange={(event) => setForm({ ...form, paperTitle: event.target.value })} placeholder="논문 제목" />
        <textarea className="memo-small" maxLength={500} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="메모" />
        <small className="char-count">{form.note.length}/500자</small>
        <div className="actions centered-actions">
          {editing && <button type="button" onClick={reset}>취소</button>}
          <button className="primary" type="submit"><Save size={16} /> {editing ? "수정 저장" : "마일리지 적립"}</button>
        </div>
      </form>
      <div className="cards">
        {data.mileageRecords.length === 0 ? <p className="empty">마일리지 기록이 없습니다.</p> : data.mileageRecords.map((record) => (
          <article className="post" key={record.id}>
            <strong>{record.memberName} · {recordText(record)}</strong>
            {record.paperTitle && <p>논문 제목: {record.paperTitle}</p>}
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

function UsageRequestsAdmin({ data, approveUsageRequest, rejectUsageRequest }) {
  const requests = data.usageRequests.sort(sortNewest);
  return (
    <section className="panel">
      <h2><CheckCircle2 size={19} /> 마일리지 사용 요청</h2>
      <div className="notice">승인하면 해당 사용 요청이 회원의 마일리지 사용 기록으로 자동 등록됩니다.</div>
      <UsageRequestList
        requests={requests}
        showMember
        actions={(request) => (
          <>
            <button className="primary" type="button" onClick={() => approveUsageRequest(request)}>승인</button>
            <button type="button" onClick={() => rejectUsageRequest(request)}>거부</button>
          </>
        )}
      />
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
  const [members, signupRequests, mileageRecords, pwRequests, usageRequests, withdrawals] = await Promise.all([
    fbGet("members"),
    fbGet("signupRequests"),
    fbGet("mileageRecords"),
    fbGet("pwRequests"),
    fbGet("usageRequests"),
    fbGet("withdrawals"),
  ]);
  return {
    members: toArray(members).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko")),
    signupRequests: toArray(signupRequests).sort(sortNewest),
    mileageRecords: toArray(mileageRecords).sort(sortNewest),
    pwRequests: toArray(pwRequests).sort(sortNewest),
    usageRequests: toArray(usageRequests).sort(sortNewest),
    withdrawals: toArray(withdrawals).sort(sortNewest),
  };
}

let resolvedDbUrl = "";

async function resolveDbUrl() {
  if (resolvedDbUrl) return resolvedDbUrl;
  const checked = [...new Set(DB_CANDIDATES)];
  for (const url of checked) {
    try {
      const response = await fetch(`${url}/.json?shallow=true`);
      if (response.status !== 404) {
        resolvedDbUrl = url;
        return resolvedDbUrl;
      }
    } catch {
      // Keep checking the next possible Realtime Database host.
    }
  }
  const error = new Error("Firebase Realtime Database was not found");
  error.status = 404;
  error.code = "DB_NOT_FOUND";
  throw error;
}

async function firebaseRequest(path, options = {}) {
  const dbUrl = await resolveDbUrl();
  const response = await fetch(`${dbUrl}/${path}.json`, options);
  if (!response.ok) {
    const error = new Error(`${options.method || "GET"} ${path} failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response;
}

async function fbGet(path) {
  const response = await firebaseRequest(path);
  const data = await response.json();
  return data === null ? undefined : data;
}

async function fbPatch(path, value) {
  await firebaseRequest(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

async function fbPut(path, value) {
  await firebaseRequest(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

async function fbDelete(path) {
  await firebaseRequest(path, { method: "DELETE" });
}

function firebaseErrorText(err, action) {
  const text = String(err?.message || err || "");
  if (err?.code === "DB_NOT_FOUND" || err?.status === 404 || text.includes("404")) {
    return `${action}을 저장하지 못했습니다. Firebase Realtime Database가 아직 만들어지지 않았거나 URL이 다릅니다. Firebase 콘솔에서 Realtime Database를 만든 뒤, Vercel 환경변수 VITE_FIREBASE_DB_URL에 실제 DB URL을 넣어주세요.`;
  }
  if (err?.status === 401 || err?.status === 403 || text.includes("401") || text.includes("403") || text.toLowerCase().includes("permission")) {
    return `${action}을 저장하지 못했습니다. Firebase Realtime Database 읽기/쓰기 규칙을 확인해주세요.`;
  }
  return `${action}을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.`;
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

function formatMileageInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? Number(digits).toLocaleString("ko-KR") : "";
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
    { name: "마일리지", columns: ["회원", "소속", "전화번호", "구분", "금액", "권", "호", "논문제목", "메모", "입력자", "일시"], rows: data.mileageRecords.map((r) => [r.memberName, r.memberAffiliation, r.memberPhone, r.type, r.amount, r.volume, r.issue, r.paperTitle, r.note, r.editorName, formatDateTime(r.createdAt)]) },
    { name: "사용요청", columns: ["회원", "소속", "전화번호", "금액", "상태", "메모", "요청일", "처리일", "처리자"], rows: data.usageRequests.map((r) => [r.memberName, r.memberAffiliation, r.memberPhone, r.amount, r.status, r.note, formatDateTime(r.createdAt), formatDateTime(r.reviewedAt), r.reviewedBy]) },
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
