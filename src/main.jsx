import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CheckCircle2,
  Database,
  Download,
  File,
  FileUp,
  Home,
  LayoutDashboard,
  Loader2,
  LogOut,
  RefreshCw,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
  UserCog,
  Users,
  XCircle,
} from 'lucide-react';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...options,
  });

  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    throw new Error(typeof data === 'string' ? data : data.message || 'Request failed.');
  }

  return data;
}

function App() {
  const inputRef = useRef(null);
  const xhrRef = useRef(null);
  const [path, setPath] = useState(window.location.pathname);
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [authStatus, setAuthStatus] = useState('Checking session...');
  const [authBusy, setAuthBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('idle');
  const [message, setMessage] = useState('Choose a file to upload.');
  const [busyFileId, setBusyFileId] = useState('');
  const [shareInputs, setShareInputs] = useState({});

  const canUpload = selectedFile && !['uploading', 'success'].includes(uploadStatus);
  const statusLabel = useMemo(() => {
    if (uploadStatus === 'uploading') return `Uploading ${Math.round(progress)}%`;
    if (uploadStatus === 'success') return 'Upload complete';
    if (uploadStatus === 'error') return 'Upload failed';
    if (uploadStatus === 'cancelled') return 'Upload cancelled';
    return selectedFile ? 'Ready to upload' : 'Waiting for file';
  }, [progress, selectedFile, uploadStatus]);

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    api('/api/auth/me')
      .then((data) => {
        setUser(data.user);
        setAuthStatus('');
        return loadFiles();
      })
      .catch(() => {
        setUser(null);
        setAuthStatus('Login or create an account to continue.');
      });
  }, []);

  function navigate(nextPath) {
    window.history.pushState({}, '', nextPath);
    setPath(nextPath);
  }

  function updateFile(nextFile) {
    setFiles((currentFiles) =>
      currentFiles.map((file) => (file.id === nextFile.id ? nextFile : file))
    );
  }

  async function loadFiles() {
    const data = await api('/api/files');
    setFiles(data.files);
  }

  function resetUpload(nextFile = null) {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setSelectedFile(nextFile);
    setProgress(0);
    setUploadStatus(nextFile ? 'ready' : 'idle');
    setMessage(nextFile ? 'File selected. Start the upload when ready.' : 'Choose a file to upload.');
  }

  async function handleAuth(event) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthStatus(authMode === 'login' ? 'Signing in...' : 'Creating account...');

    try {
      const data = await api(`/api/auth/${authMode}`, {
        method: 'POST',
        body: JSON.stringify(authForm),
      });
      setUser(data.user);
      setAuthForm({ email: '', password: '' });
      setAuthStatus('');
      await loadFiles();
    } catch (error) {
      setAuthStatus(error.message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setFiles([]);
    resetUpload();
    setAuthStatus('Logged out.');
    navigate('/');
  }

  function handleFileChange(event) {
    const nextFile = event.target.files?.[0] || null;
    resetUpload(nextFile);
  }

  function handleDrop(event) {
    event.preventDefault();
    const nextFile = event.dataTransfer.files?.[0] || null;
    if (nextFile) resetUpload(nextFile);
  }

  function uploadFile() {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append('file', selectedFile);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress((event.loaded / event.total) * 100);
      }
    };

    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        setFiles((currentFiles) => [data.file, ...currentFiles]);
        setProgress(100);
        setUploadStatus('success');
        setMessage('The file was saved and added to your account.');
        return;
      }

      setUploadStatus('error');
      try {
        setMessage(JSON.parse(xhr.responseText).message || 'The server rejected the upload.');
      } catch {
        setMessage(xhr.responseText || 'The server rejected the upload.');
      }
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      setUploadStatus('error');
      setMessage('The upload could not reach the server.');
    };

    xhr.onabort = () => {
      setUploadStatus('cancelled');
      setMessage('The upload was stopped.');
    };

    setUploadStatus('uploading');
    setMessage('Keep this tab open until the upload finishes.');
    xhr.open('POST', `${API_BASE}/api/upload`);
    xhr.send(formData);
  }

  async function shareFile(file) {
    const email = (shareInputs[file.id] || '').trim();
    if (!email) return;

    setBusyFileId(file.id);
    try {
      const data = await api(`/api/files/${file.id}/share`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      updateFile(data.file);
      setShareInputs((current) => ({ ...current, [file.id]: '' }));
    } catch (error) {
      setMessage(error.message);
      setUploadStatus('error');
    } finally {
      setBusyFileId('');
    }
  }

  async function removeShare(file, email) {
    setBusyFileId(file.id);
    try {
      const data = await api(`/api/files/${file.id}/share/${encodeURIComponent(email)}`, {
        method: 'DELETE',
      });
      updateFile(data.file);
    } catch (error) {
      setMessage(error.message);
      setUploadStatus('error');
    } finally {
      setBusyFileId('');
    }
  }

  if (!user) {
    return (
      <AuthScreen
        authBusy={authBusy}
        authForm={authForm}
        authMode={authMode}
        authStatus={authStatus}
        handleAuth={handleAuth}
        setAuthForm={setAuthForm}
        setAuthMode={setAuthMode}
      />
    );
  }

  if (path === '/admin') {
    if (user.role !== 'admin') {
      return <AccessDenied navigate={navigate} logout={logout} user={user} />;
    }

    return <AdminPanel navigate={navigate} logout={logout} user={user} />;
  }

  return (
    <main className="page app-page">
      <Topbar navigate={navigate} logout={logout} user={user} currentPath={path} />

      <section className="workspace">
        <div className="upload-panel">
          <button
            className="drop-zone"
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            disabled={uploadStatus === 'uploading'}
          >
            <Upload size={32} />
            <span>{selectedFile ? 'Change selected file' : 'Select or drop a file'}</span>
          </button>

          <input ref={inputRef} className="file-input" type="file" onChange={handleFileChange} />

          <div className="current-file" aria-live="polite">
            <div className="file-details">
              <span className="file-name">{selectedFile?.name || 'No file selected'}</span>
              <span className="file-meta">
                {selectedFile ? formatBytes(selectedFile.size) : 'Only the current upload is shown here.'}
              </span>
            </div>
            <StatusIcon status={uploadStatus} />
          </div>

          <div className="progress-wrap" aria-label={statusLabel}>
            <div className="progress-track">
              <div className="progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-row">
              <span>{statusLabel}</span>
              <strong>{Math.round(progress)}%</strong>
            </div>
          </div>

          <p className={`status-message status-${uploadStatus}`}>{message}</p>

          <div className="actions">
            {uploadStatus === 'uploading' ? (
              <button className="button secondary" type="button" onClick={() => xhrRef.current?.abort()}>
                Cancel
              </button>
            ) : (
              <button className="button secondary" type="button" onClick={() => resetUpload()}>
                Clear
              </button>
            )}
            <button className="button primary" type="button" onClick={uploadFile} disabled={!canUpload}>
              Upload file
            </button>
          </div>
        </div>

        <div className="files-panel">
          <div className="panel-head">
            <div>
              <h2>Your Files</h2>
              <p>Owned files and files shared with your email.</p>
            </div>
            <button className="icon-button" type="button" onClick={loadFiles} title="Refresh files">
              <RefreshCw size={19} />
            </button>
          </div>

          <div className="file-list">
            {files.length === 0 ? (
              <EmptyState />
            ) : (
              files.map((file) => (
                <FileCard
                  busyFileId={busyFileId}
                  file={file}
                  key={file.id}
                  removeShare={removeShare}
                  shareFile={shareFile}
                  shareInputs={shareInputs}
                  setShareInputs={setShareInputs}
                />
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function AuthScreen({
  authBusy,
  authForm,
  authMode,
  authStatus,
  handleAuth,
  setAuthForm,
  setAuthMode,
}) {
  return (
    <main className="page auth-page">
      <section className="auth-shell">
        <div className="heading">
          <div className="brand-mark" aria-hidden="true">
            <ShieldCheck size={28} />
          </div>
          <div>
            <h1>File Access Portal</h1>
            <p>Sign in with your email to upload, download, and share files.</p>
          </div>
        </div>

        <div className="segmented" aria-label="Authentication mode">
          <button
            className={authMode === 'login' ? 'active' : ''}
            type="button"
            onClick={() => setAuthMode('login')}
          >
            Login
          </button>
          <button
            className={authMode === 'register' ? 'active' : ''}
            type="button"
            onClick={() => setAuthMode('register')}
          >
            Register
          </button>
        </div>

        <form className="auth-form" onSubmit={handleAuth}>
          <label>
            Email
            <input
              type="email"
              value={authForm.email}
              onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
              placeholder="name@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={authForm.password}
              onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
              placeholder="At least 8 characters"
              autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
              minLength={8}
              required
            />
          </label>
          <button className="button primary" type="submit" disabled={authBusy}>
            {authBusy ? 'Please wait' : authMode === 'login' ? 'Login' : 'Create account'}
          </button>
        </form>

        <p className="status-message">{authStatus}</p>
      </section>
    </main>
  );
}

function Topbar({ currentPath, navigate, logout, user }) {
  return (
    <section className="topbar">
      <div className="heading compact">
        <div className="brand-mark" aria-hidden="true">
          <FileUp size={24} />
        </div>
        <div>
          <h1>File Access Portal</h1>
          <p>
            {user.email} · {user.role}
          </p>
        </div>
      </div>

      <div className="nav-actions">
        <button
          className={`nav-button ${currentPath === '/' ? 'active' : ''}`}
          type="button"
          onClick={() => navigate('/')}
        >
          <Home size={17} />
          Files
        </button>
        {user.role === 'admin' && (
          <button
            className={`nav-button ${currentPath === '/admin' ? 'active' : ''}`}
            type="button"
            onClick={() => navigate('/admin')}
          >
            <LayoutDashboard size={17} />
            Admin
          </button>
        )}
        <button className="icon-button" type="button" onClick={logout} title="Logout">
          <LogOut size={19} />
        </button>
      </div>
    </section>
  );
}

function FileCard({ busyFileId, file, removeShare, shareFile, shareInputs, setShareInputs }) {
  return (
    <article className="file-row">
      <div className="file-main">
        <File size={22} />
        <div className="file-details">
          <span className="file-name">{file.originalName}</span>
          <span className="file-meta">
            {formatBytes(file.size)} · {formatDate(file.createdAt)}
          </span>
          <span className="file-meta">
            {file.access === 'owner'
              ? 'Owned by you'
              : file.access === 'admin'
                ? `Admin access · owner ${file.ownerEmail}`
                : `Shared by ${file.ownerEmail}`}
          </span>
        </div>
      </div>

      <div className="file-actions">
        <a className="icon-button" href={`${API_BASE}/api/files/${file.id}/download`} title="Download file">
          <Download size={19} />
        </a>
      </div>

      {(file.access === 'owner' || file.access === 'admin') && (
        <div className="share-area">
          <div className="share-form">
            <input
              type="email"
              value={shareInputs[file.id] || ''}
              onChange={(event) =>
                setShareInputs((current) => ({
                  ...current,
                  [file.id]: event.target.value,
                }))
              }
              placeholder="share-with@example.com"
            />
            <button
              className="button small"
              type="button"
              onClick={() => shareFile(file)}
              disabled={busyFileId === file.id}
            >
              <Share2 size={16} />
              Share
            </button>
          </div>

          {file.sharedWith.length > 0 && (
            <div className="chips">
              {file.sharedWith.map((email) => (
                <span className="chip" key={email}>
                  {email}
                  <button
                    type="button"
                    onClick={() => removeShare(file, email)}
                    disabled={busyFileId === file.id}
                    title={`Remove ${email}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function AdminPanel({ navigate, logout, user }) {
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    loadAdminData();
  }, []);

  async function loadAdminData() {
    setLoading(true);
    setError('');

    try {
      const [summaryData, usersData, filesData] = await Promise.all([
        api('/api/admin/summary'),
        api('/api/admin/users'),
        api('/api/admin/files'),
      ]);
      setSummary(summaryData.summary);
      setUsers(usersData.users);
      setFiles(filesData.files);
    } catch (adminError) {
      setError(adminError.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateRole(targetUser, role) {
    setBusyId(targetUser.id);
    setError('');

    try {
      const data = await api(`/api/admin/users/${targetUser.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setUsers((currentUsers) =>
        currentUsers.map((currentUser) =>
          currentUser.id === targetUser.id ? { ...currentUser, role: data.user.role } : currentUser
        )
      );
    } catch (roleError) {
      setError(roleError.message);
    } finally {
      setBusyId('');
    }
  }

  async function deleteFile(file) {
    if (!window.confirm(`Delete "${file.originalName}" permanently?`)) return;

    setBusyId(file.id);
    setError('');

    try {
      await api(`/api/admin/files/${file.id}`, { method: 'DELETE' });
      setFiles((currentFiles) => currentFiles.filter((currentFile) => currentFile.id !== file.id));
      setSummary((currentSummary) =>
        currentSummary
          ? {
              ...currentSummary,
              fileCount: Math.max(currentSummary.fileCount - 1, 0),
              totalBytes: Math.max(currentSummary.totalBytes - file.size, 0),
            }
          : currentSummary
      );
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <main className="page app-page">
      <Topbar currentPath="/admin" navigate={navigate} logout={logout} user={user} />

      <section className="admin-grid">
        <div className="admin-hero">
          <div>
            <h2>Admin Panel</h2>
            <p>Review users, storage, roles, and every uploaded file.</p>
          </div>
          <button className="button secondary" type="button" onClick={loadAdminData} disabled={loading}>
            <RefreshCw size={17} />
            Refresh
          </button>
        </div>

        {error && <p className="alert">{error}</p>}

        <div className="stat-grid">
          <StatCard icon={<Users size={20} />} label="Users" value={summary?.userCount ?? '-'} />
          <StatCard icon={<UserCog size={20} />} label="Admins" value={summary?.adminCount ?? '-'} />
          <StatCard icon={<File size={20} />} label="Files" value={summary?.fileCount ?? '-'} />
          <StatCard icon={<Database size={20} />} label="Storage" value={formatBytes(summary?.totalBytes || 0)} />
        </div>

        <section className="table-panel">
          <div className="panel-head">
            <div>
              <h2>Users</h2>
              <p>Promote or demote accounts. At least one admin is always required.</p>
            </div>
          </div>

          <div className="data-table">
            <div className="table-row table-head">
              <span>Email</span>
              <span>Role</span>
              <span>Files</span>
              <span>Storage</span>
              <span>Action</span>
            </div>
            {users.map((adminUser) => (
              <div className="table-row" key={adminUser.id}>
                <span className="truncate">{adminUser.email}</span>
                <span>
                  <span className={`badge ${adminUser.role}`}>{adminUser.role}</span>
                </span>
                <span>{adminUser.fileCount}</span>
                <span>{formatBytes(adminUser.totalBytes)}</span>
                <span>
                  <button
                    className="button small secondary"
                    type="button"
                    onClick={() => updateRole(adminUser, adminUser.role === 'admin' ? 'user' : 'admin')}
                    disabled={busyId === adminUser.id}
                  >
                    {adminUser.role === 'admin' ? 'Make user' : 'Make admin'}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="table-panel">
          <div className="panel-head">
            <div>
              <h2>All Files</h2>
              <p>Admins can download or permanently remove any file.</p>
            </div>
          </div>

          <div className="data-table">
            <div className="table-row file-table table-head">
              <span>File</span>
              <span>Owner</span>
              <span>Size</span>
              <span>Uploaded</span>
              <span>Actions</span>
            </div>
            {files.length === 0 && <div className="table-empty">No files uploaded yet.</div>}
            {files.map((file) => (
              <div className="table-row file-table" key={file.id}>
                <span className="truncate">{file.originalName}</span>
                <span className="truncate">{file.ownerEmail}</span>
                <span>{formatBytes(file.size)}</span>
                <span>{formatDate(file.createdAt)}</span>
                <span className="row-actions">
                  <a className="icon-button" href={`${API_BASE}/api/files/${file.id}/download`} title="Download file">
                    <Download size={18} />
                  </a>
                  <button
                    className="icon-button danger"
                    type="button"
                    onClick={() => deleteFile(file)}
                    disabled={busyId === file.id}
                    title="Delete file"
                  >
                    <Trash2 size={18} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <article className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function AccessDenied({ navigate, logout, user }) {
  return (
    <main className="page app-page">
      <Topbar currentPath="/admin" navigate={navigate} logout={logout} user={user} />
      <section className="auth-shell">
        <div className="heading">
          <div className="brand-mark" aria-hidden="true">
            <ShieldCheck size={28} />
          </div>
          <div>
            <h1>Admin access required</h1>
            <p>Your account does not have permission to open this panel.</p>
          </div>
        </div>
        <button className="button primary" type="button" onClick={() => navigate('/')}>
          Back to files
        </button>
      </section>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <File size={30} />
      <span>No files available yet.</span>
    </div>
  );
}

function StatusIcon({ status }) {
  if (status === 'uploading') return <Loader2 className="spin status-icon uploading" size={26} />;
  if (status === 'success') return <CheckCircle2 className="status-icon success" size={26} />;
  if (status === 'error') return <XCircle className="status-icon error" size={26} />;
  return <FileUp className="status-icon" size={26} />;
}

createRoot(document.getElementById('root')).render(<App />);
