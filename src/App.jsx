import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import './App.css'

// NTFY PLACEHOLDER: replace this with the exact topic that worked on your phone.
const NTFY_TOPIC = 'noted-labib-7x29-k4m8-p91q'

function App() {
  const [user, setUser] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [checkingSession, setCheckingSession] = useState(true)

  const [type, setType] = useState('praise')
  const [description, setDescription] = useState('')
  const [level, setLevel] = useState(1)
  const [files, setFiles] = useState([])
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')

  const [messages, setMessages] = useState([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [historyError, setHistoryError] = useState('')

  useEffect(() => {
    const checkLogin = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session) {
        setUser('labib')
        setCheckingSession(false)
        return
      }

      const savedUser = localStorage.getItem('noted_user')

      if (savedUser === 'resna') {
        setUser('resna')
      }

      setCheckingSession(false)
    }

    checkLogin()
  }, [])

  const loadMessages = async (quiet = false) => {
    if (!quiet) setLoadingMessages(true)
    setHistoryError('')

    const { data, error } = await supabase
      .from('messages')
      .select('id, type, description, complaint_level, is_read, attachment_url, attachment_urls, created_at')
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

    // Keeps Resna's "Seen" status reasonably fresh without requiring a refresh.
    const timer = setInterval(() => loadMessages(true), 10000)
    return () => clearInterval(timer)
  }, [user])

  const loginAsResna = () => {
    localStorage.setItem('noted_user', 'resna')
    setUser('resna')
  }

  const loginAsLabib = async () => {
    setLoginError('')

    if (!password) {
      setLoginError('Enter your password.')
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: 'labib@noted.local',
      password,
    })

    if (error) {
      console.error(error)
      setLoginError('Wrong password.')
      return
    }

    localStorage.removeItem('noted_user')
    setPassword('')
    setUser('labib')
  }

  const logout = async () => {
    if (user === 'labib') {
      await supabase.auth.signOut()
    }

    localStorage.removeItem('noted_user')
    setUser(null)
    setSelectedUser(null)
    setPassword('')
    setLoginError('')
    setMessages([])
  }

  const submitMessage = async () => {
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

    // Send a phone notification through ntfy.
    // The message is already safely stored in Supabase even if ntfy fails.
    let notificationWorked = true

    try {
      if (NTFY_TOPIC !== 'YOUR_NTFY_TOPIC_HERE') {
        const isComplaint = type === 'complaint'

        const notificationResponse = await fetch('https://ntfy.sh/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            topic: NTFY_TOPIC,
            title: 'Noted.',
            message: isComplaint
              ? `New complaint · Level ${level}\n${description.trim()}`
              : `New praise\n${description.trim()}`,
            priority: isComplaint && level >= 4 ? 4 : 3,
            tags: isComplaint ? ['warning'] : ['heart'],
          }),
        })

        if (!notificationResponse.ok) {
          notificationWorked = false
          const ntfyErrorText = await notificationResponse.text()
          console.error(
            'ntfy failed:',
            notificationResponse.status,
            ntfyErrorText,
          )
        }
      } else {
        notificationWorked = false
        console.warn('NTFY_TOPIC placeholder has not been replaced yet.')
      }
    } catch (notificationError) {
      notificationWorked = false
      console.error('Notification failed:', notificationError)
    }

    setDescription('')
    setFiles([])
    setLevel(1)
    setType('praise')
    setMessage(notificationWorked ? 'Sent.' : 'Sent, but phone notification failed.')
    setSending(false)
    await loadMessages(true)
  }

  const setReadState = async (item, nextValue) => {
    if (user !== 'labib') return

    // Update instantly in the UI, then save it.
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
              onClick={() => {
                setSelectedUser('resna')
                setPassword('')
                setLoginError('')
              }}
            >
              Resna
            </button>

            <button
              className={selectedUser === 'labib' ? 'person active-person' : 'person'}
              onClick={() => {
                setSelectedUser('labib')
                setPassword('')
                setLoginError('')
              }}
            >
              Labib
            </button>
          </div>

          {selectedUser === 'resna' && (
            <button className="send-button" onClick={loginAsResna}>
              Enter
            </button>
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
                  if (e.key === 'Enter') loginAsLabib()
                }}
              />

              <button className="send-button" onClick={loginAsLabib}>
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
                onChange={(e) => {
                  setFiles(Array.from(e.target.files || []))
                }}
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
                        setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
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

            <button className="refresh-button" onClick={() => loadMessages()} disabled={loadingMessages}>
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
                className={`history-item ${item.type === 'complaint' ? `complaint-item level-${item.complaint_level}` : 'praise-item'}`}
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
