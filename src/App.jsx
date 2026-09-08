import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import './App.css'

const LABIB_EMAIL = 'labib@noted.local'
const RESNA_EMAIL = 'resna@noted.local'

function App() {
  const [user, setUser] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [loginError, setLoginError] = useState('')
  const [checkingSession, setCheckingSession] = useState(true)
  const [checkingResnaSetup, setCheckingResnaSetup] = useState(false)
  const [resnaNeedsSetup, setResnaNeedsSetup] = useState(false)
  const [creatingResna, setCreatingResna] = useState(false)

  const [type, setType] = useState('praise')
  const [description, setDescription] = useState('')
  const [level, setLevel] = useState(1)
  const [files, setFiles] = useState([])
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')

  const [messages, setMessages] = useState([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [historyError, setHistoryError] = useState('')

  const identifyUser = (session) => {
    const email = session?.user?.email?.toLowerCase()
    if (email === LABIB_EMAIL) return 'labib'
    if (email === RESNA_EMAIL) return 'resna'
    return null
  }

  useEffect(() => {
    const checkLogin = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      setUser(identifyUser(session))
      setCheckingSession(false)
    }

    checkLogin()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(identifyUser(session))
    })

    return () => subscription.unsubscribe()
  }, [])

  const resetLoginFields = () => {
    setPassword('')
    setConfirmPassword('')
    setSetupCode('')
    setLoginError('')
  }

  const checkResnaSetup = async () => {
    setCheckingResnaSetup(true)
    setLoginError('')

    try {
      const { data, error } = await supabase.functions.invoke('resna-setup', {
        method: 'GET',
      })

      if (error) throw error

      setResnaNeedsSetup(!data?.setupComplete)
    } catch (error) {
      console.error(error)
      setLoginError('Could not check Resna account setup.')
    } finally {
      setCheckingResnaSetup(false)
    }
  }

  const chooseUser = async (nextUser) => {
    setSelectedUser(nextUser)
    resetLoginFields()

    if (nextUser === 'resna') {
      await checkResnaSetup()
    } else {
      setResnaNeedsSetup(false)
    }
  }

  const login = async () => {
    setLoginError('')

    if (!password) {
      setLoginError('Enter your password.')
      return
    }

    const email = selectedUser === 'resna' ? RESNA_EMAIL : LABIB_EMAIL

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.error(error)
      setLoginError('Wrong password.')
      return
    }

    resetLoginFields()
  }

  const createResnaAccount = async () => {
    setLoginError('')

    if (!setupCode.trim()) {
      setLoginError('Enter the one-time setup code.')
      return
    }

    if (password.length < 6) {
      setLoginError('Password must be at least 6 characters.')
      return
    }

    if (password !== confirmPassword) {
      setLoginError('Passwords do not match.')
      return
    }

    setCreatingResna(true)

    try {
      const { data, error } = await supabase.functions.invoke('resna-setup', {
        body: {
          setupCode: setupCode.trim(),
          password,
        },
      })

      if (error) throw error

      if (!data?.success) {
        setLoginError(data?.error || 'Could not create account.')
        return
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: RESNA_EMAIL,
        password,
      })

      if (signInError) {
        console.error(signInError)
        setResnaNeedsSetup(false)
        setLoginError('Password created. Enter it again to log in.')
        return
      }

      setResnaNeedsSetup(false)
      resetLoginFields()
    } catch (error) {
      console.error(error)
      setLoginError('Could not create Resna account.')
    } finally {
      setCreatingResna(false)
    }
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSelectedUser(null)
    resetLoginFields()
    setMessages([])
  }

  const loadMessages = async (quiet = false) => {
    if (!quiet) setLoadingMessages(true)
    setHistoryError('')

    const { data, error } = await supabase
      .from('messages')
      .select(
        'id, type, description, complaint_level, is_read, attachment_url, attachment_urls, created_at',
      )
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      setHistoryError('Could not load the log.')
    } else {
      setMessages(data || [])
    }

    if (!quiet) setLoadingMessages(false)
  }

  useEffect(() => {
    if (!user) return

    loadMessages()

    const timer = setInterval(() => loadMessages(true), 10000)
    return () => clearInterval(timer)
  }, [user])

  const submitMessage = async () => {
    if (user !== 'resna') return

    if (!description.trim()) {
      setMessage('Write something first.')
      return
    }

    setSending(true)
    setMessage('')

    const attachmentUrls = []

    for (const selectedFile of files) {
      const fileExt = selectedFile.name.split('.').pop()
      const fileName = `${Date.now()}-${crypto.randomUUID()}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('attachments')
        .upload(fileName, selectedFile)

      if (uploadError) {
        console.error(uploadError)
        setMessage('Attachment upload failed.')
        setSending(false)
        return
      }

      const { data } = supabase.storage
        .from('attachments')
        .getPublicUrl(fileName)

      attachmentUrls.push(data.publicUrl)
    }

    const { error } = await supabase.from('messages').insert([
      {
        type,
        description: description.trim(),
        complaint_level: type === 'complaint' ? level : null,
        attachment_urls: attachmentUrls,
      },
    ])

    if (error) {
      console.error(error)
      setMessage('Could not send.')
      setSending(false)
      return
    }

    setDescription('')
    setFiles([])
    setLevel(1)
    setType('praise')
    setMessage('Sent.')
    setSending(false)
    await loadMessages(true)
  }

  const setReadState = async (item, nextValue) => {
    if (user !== 'labib') return

    setMessages((current) =>
      current.map((messageItem) =>
        messageItem.id === item.id
          ? { ...messageItem, is_read: nextValue }
          : messageItem,
      ),
    )

    const { error } = await supabase
      .from('messages')
      .update({ is_read: nextValue })
      .eq('id', item.id)

    if (error) {
      console.error(error)
      setHistoryError('Could not update the tick.')
      await loadMessages(true)
    }
  }

  const monthCounts = useMemo(() => {
    const now = new Date()

    return messages.reduce(
      (counts, item) => {
        const date = new Date(item.created_at)
        const sameMonth =
          date.getFullYear() === now.getFullYear() &&
          date.getMonth() === now.getMonth()

        if (!sameMonth) return counts

        if (item.type === 'praise') counts.praise += 1
        if (item.type === 'complaint') counts.complaint += 1
        return counts
      },
      { praise: 0, complaint: 0 },
    )
  }, [messages])

  const formatDate = (value) =>
    new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))

  if (checkingSession) {
    return (
      <div className="page">
        <div className="card loading-card">
          <h1>Noted.</h1>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="page">
        <div className="card login-card">
          <h1>Noted.</h1>
          <p className="subtitle">Who are you?</p>

          <div className="login-choice">
            <button
              className={selectedUser === 'resna' ? 'person active-person' : 'person'}
              onClick={() => chooseUser('resna')}
            >
              Resna
            </button>

            <button
              className={selectedUser === 'labib' ? 'person active-person' : 'person'}
              onClick={() => chooseUser('labib')}
            >
              Labib
            </button>
          </div>

          {selectedUser === 'resna' && checkingResnaSetup && (
            <p className="status">Checking account…</p>
          )}

          {selectedUser === 'resna' && !checkingResnaSetup && (
            <div className="password-area">
              {resnaNeedsSetup ? (
                <>
                  <p className="setup-note">
                    First time only — create your password.
                  </p>

                  <input
                    className="password-input"
                    type="password"
                    placeholder="One-time setup code"
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value)}
                  />

                  <input
                    className="password-input stacked-input"
                    type="password"
                    placeholder="Create password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />

                  <input
                    className="password-input stacked-input"
                    type="password"
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createResnaAccount()
                    }}
                  />

                  <button
                    className="send-button"
                    onClick={createResnaAccount}
                    disabled={creatingResna}
                  >
                    {creatingResna ? 'Creating…' : 'Create password'}
                  </button>
                </>
              ) : (
                <>
                  <input
                    className="password-input"
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') login()
                    }}
                  />

                  <button className="send-button" onClick={login}>
                    Enter
                  </button>
                </>
              )}
            </div>
          )}

          {selectedUser === 'labib' && (
            <div className="password-area">
              <input
                className="password-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') login()
                }}
              />

              <button className="send-button" onClick={login}>
                Enter
              </button>
            </div>
          )}

          {loginError && <p className="status error-status">{loginError}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <main className="card main-card">
        <div className="top-bar">
          <span className="logged-in">{user === 'resna' ? 'Resna' : 'Labib'}</span>
          <button className="logout-button" onClick={logout}>
            Logout
          </button>
        </div>

        <h1>Noted.</h1>
        <p className="subtitle">
          {user === 'resna'
            ? 'Leave something worth remembering.'
            : 'Everything she left for you.'}
        </p>

        <div className="stats">
          <div className="stat praise-stat">
            <span className="stat-number">{monthCounts.praise}</span>
            <span className="stat-label">Praise this month</span>
          </div>

          <div className="stat complaint-stat">
            <span className="stat-number">{monthCounts.complaint}</span>
            <span className="stat-label">Complaints this month</span>
          </div>
        </div>

        {user === 'resna' && (
          <section className="composer-section">
            <div className="type-buttons">
              <button
                className={type === 'praise' ? 'active' : ''}
                onClick={() => {
                  setType('praise')
                  setMessage('')
                }}
              >
                Praise
              </button>

              <button
                className={type === 'complaint' ? 'active complaint' : ''}
                onClick={() => {
                  setType('complaint')
                  setMessage('')
                }}
              >
                Complaint
              </button>
            </div>

            <textarea
              placeholder={type === 'praise' ? 'Say something nice...' : 'What happened?'}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            {type === 'complaint' && (
              <div className={`slider-wrap level-${level}`}>
                <div className="slider-label">
                  <span>Complaint level</span>
                  <span className="level-number">{level}/5</span>
                </div>

                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={level}
                  onChange={(e) => setLevel(Number(e.target.value))}
                />
              </div>
            )}

            <label className="file-label">
              + Add screenshots
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
            </label>

            {files.length > 0 && (
              <div className="selected-files">
                {files.map((selectedFile, index) => (
                  <div className="selected-file" key={`${selectedFile.name}-${index}`}>
                    <span>{selectedFile.name}</span>
                    <button
                      type="button"
                      className="remove-file-button"
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, fileIndex) => fileIndex !== index),
                        )
                      }
                      aria-label={`Remove ${selectedFile.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button className="send-button" onClick={submitMessage} disabled={sending}>
              {sending ? 'Sending...' : 'Send'}
            </button>

            {message && <p className="status">{message}</p>}
          </section>
        )}

        <section className="history-section">
          <div className="history-heading-row">
            <div>
              <p className="eyebrow">Shared log</p>
              <h2>History</h2>
            </div>

            <button
              className="refresh-button"
              onClick={() => loadMessages()}
              disabled={loadingMessages}
            >
              {loadingMessages ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {historyError && <p className="status error-status">{historyError}</p>}

          {!loadingMessages && messages.length === 0 && !historyError && (
            <div className="empty-history">Nothing here yet.</div>
          )}

          <div className="history-list">
            {messages.map((item) => (
              <article
                className={`history-item ${
                  item.type === 'complaint'
                    ? `complaint-item level-${item.complaint_level}`
                    : 'praise-item'
                }`}
                key={item.id}
              >
                <div className="history-item-top">
                  <div className="history-type-wrap">
                    <span className={`type-pill ${item.type}`}>
                      {item.type === 'praise' ? '♥ Praise' : '⚠ Complaint'}
                    </span>

                    {item.type === 'complaint' && (
                      <span className={`level-pill level-${item.complaint_level}`}>
                        Level {item.complaint_level}
                      </span>
                    )}
                  </div>

                  {user === 'labib' ? (
                    <label className="read-control">
                      <input
                        type="checkbox"
                        checked={Boolean(item.is_read)}
                        onChange={(e) => setReadState(item, e.target.checked)}
                      />
                      <span>{item.is_read ? 'Read' : 'Mark read'}</span>
                    </label>
                  ) : (
                    <span className={`seen-status ${item.is_read ? 'seen' : 'unseen'}`}>
                      {item.is_read ? '✓ Seen' : '○ Not seen'}
                    </span>
                  )}
                </div>

                <p className="history-message">{item.description}</p>

                {(() => {
                  const urls = [
                    ...(Array.isArray(item.attachment_urls) ? item.attachment_urls : []),
                    ...(item.attachment_url ? [item.attachment_url] : []),
                  ].filter(Boolean)

                  if (urls.length === 0) return null

                  return (
                    <div className="attachment-list">
                      {urls.map((url, index) => (
                        <a
                          className="attachment-link"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          key={`${url}-${index}`}
                        >
                          View screenshot {urls.length > 1 ? index + 1 : ''} ↗
                        </a>
                      ))}
                    </div>
                  )
                })()}

                <time className="history-date" dateTime={item.created_at}>
                  {formatDate(item.created_at)}
                </time>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
