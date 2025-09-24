import React, { useEffect, useRef, useState, useMemo } from 'react'
import { jwtDecode } from 'jwt-decode'

const API = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

const secondsToTime = (s) => {
  const m = Math.floor(s / 60).toString().padStart(2, '0')
  const ss = Math.floor(s % 60).toString().padStart(2, '0')
  const ms = Math.floor((s * 1000) % 1000).toString().padStart(3, '0')
  return `${m}:${ss}.${ms}`
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [user, setUser] = useState(null)
  const [view, setView] = useState('login') // 'login' | 'editor'
  const [serverConfig, setServerConfig] = useState({ features:{}, cognito:{}, s3:{} })
  const [files, setFiles] = useState([])
  const [project, setProject] = useState(null)
  const [projects, setProjects] = useState([])
  const [status, setStatus] = useState('')
  const [preset, setPreset] = useState('fast')
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [zoom, setZoom] = useState(50) // px per second
  const stageRef = useRef()
  const rafRef = useRef()
  const startRef = useRef(0)
  const dragRef = useRef(null)
  const tracksRef = useRef(null)
  const tracksInnerRef = useRef(null)
  const rulerOffsetRef = useRef(0)
  const [rulerOffset, setRulerOffset] = useState(0)
  const rulerInnerRef = useRef(null)
  const projectRef = useRef(null)
  const [timelineHeight, setTimelineHeight] = useState(180)
  const resizingRef = useRef(null)

  // Load server config and handle Cognito redirect tokens
  useEffect(() => {
    fetch(`${API}/api/v1/config`).then(r=>r.json()).then(setServerConfig).catch(()=>{})

    // Parse Cognito Hosted UI implicit flow tokens from hash
    if (location.hash && location.hash.includes('id_token')) {
      const params = new URLSearchParams(location.hash.replace(/^#/, ''))
      const idToken = params.get('id_token')
      if (idToken) {
        const tk = `Bearer ${idToken}`
        localStorage.setItem('token', tk)
        setToken(tk)
        history.replaceState(null, '', location.pathname)
      }
    }

    if (!token) return
    try {
      const u = jwtDecode(token.split(' ')[1] || token)
  setUser(u)
  setView('editor')
      fetchFiles(1)
      fetchProjects()
    } catch {}
  }, [token])

  useEffect(() => { projectRef.current = project }, [project])

  const authFetch = (url, opts={}) => fetch(url, { ...opts, headers: { ...(opts.headers||{}), 'Authorization': token }}).then(r=>r.json())

  const login = async (username, password) => {
    const res = await fetch(`${API}/api/v1/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username,password}) })
    if (!res.ok) { alert('Login failed'); return }
    const data = await res.json()
    const tk = `Bearer ${data.token}`
    localStorage.setItem('token', tk)
    setToken(tk)
  }

  const loginWithCognito = () => {
    const domain = serverConfig?.cognito?.domain
    const clientId = serverConfig?.cognito?.clientId
    if (!domain || !clientId) { alert('Cognito not configured'); return }
    const redirectUri = encodeURIComponent(window.location.origin)
    const scope = encodeURIComponent('openid email profile')
    const url = `${domain}/oauth2/authorize?client_id=${clientId}&response_type=token&scope=${scope}&redirect_uri=${redirectUri}`
    window.location.href = url
  }

  const logout = () => { localStorage.removeItem('token'); setToken(''); setUser(null); setView('login') }

  const fetchFiles = async (page=1) => {
    const data = await authFetch(`${API}/api/v1/files?page=${page}&limit=200`)
    setFiles(data.items||[])
  }

  const fetchProjects = async () => {
    const data = await authFetch(`${API}/api/v1/projects?limit=50`)
    setProjects(data.items||[])
    if (!project && data.items && data.items.length) setProject(data.items[0])
  }

  const createProject = async () => {
    const name = prompt('Project name?','My Project')
    if (!name) return
    const data = await authFetch(`${API}/api/v1/projects`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, width:1920, height:1080, fps:30 }) })
    if (data && data.id) { setProject(data); fetchProjects() }
  }

  const saveTimeline = async (p) => {
    const data = await authFetch(`${API}/api/v1/projects/${p.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(p) })
    if (data && data.id) { setProject(data) }
  }

  const onUpload = async (e) => {
    const useS3 = !!serverConfig?.features?.useS3
    const selected = Array.from(e.target.files || [])
    if (selected.length === 0) return
    if (!useS3) {
      const form = new FormData()
      for (const f of selected) form.append('files', f)
      const res = await fetch(`${API}/api/v1/files`, { method:'POST', headers:{ 'Authorization': token }, body: form })
      if (res.ok) { fetchFiles() }
      return
    }
    // S3 presigned path
    for (const f of selected) {
      const presignRes = await fetch(`${API}/api/v1/files/presign-upload`, {
        method:'POST',
        headers:{ 'Authorization': token, 'Content-Type':'application/json' },
        body: JSON.stringify({ filename: f.name, contentType: f.type || 'application/octet-stream' })
      })
      if (!presignRes.ok) { alert('Failed to get presigned URL'); return }
      const presigned = await presignRes.json()
      const putRes = await fetch(presigned.url, { method:'PUT', headers:{ 'Content-Type': f.type || 'application/octet-stream' }, body: f })
      if (!putRes.ok) { alert('Upload to S3 failed'); return }
      const regRes = await fetch(`${API}/api/v1/files/register`, {
        method:'POST',
        headers:{ 'Authorization': token, 'Content-Type':'application/json' },
        body: JSON.stringify({ id: presigned.id, originalName: f.name, key: presigned.key, mimetype: f.type })
      })
      if (!regRes.ok) { alert('Register file failed'); return }
    }
    fetchFiles()
  }

  const addClip = (trackIndex, file) => {
    if (!project) return
    const t = project.tracks[trackIndex]
    const start = playhead
    const duration = Math.min(file.duration || 5, 10)
    const clip = { id: crypto.randomUUID(), fileId:file.id, name:file.name, in:0, out:duration, start, type:t.type }
    // If adding a video with audio, also drop an audio clip to first audio track
    let extra = []
    if (file.mimetype?.startsWith('video')) {
      const ai = project.tracks.findIndex(tr=> tr.type==='audio')
      if (ai>=0) extra.push({ track: ai, clip:{ ...clip, id: crypto.randomUUID(), type:'audio' } })
    }
    const next = { ...project, tracks: project.tracks.map((tr,i)=> {
      if (i===trackIndex) return { ...tr, clips:[...tr.clips, clip] }
      const add = extra.find(e=> e.track===i)
      if (add) return { ...tr, clips:[...tr.clips, add.clip] }
      return tr
    }) }
    setProject(next)
    saveTimeline(next)
  }

  const timelineWidth = 1200
  const duration = useMemo(()=> {
    if (!project) return 60
    let max = 10
    for (const t of project.tracks) for (const c of t.clips) max = Math.max(max, c.start + (c.out - c.in))
    return Math.ceil(max + 1)
  }, [project])

  // Simple preview: stack <video> tags; play by syncing currentTime via RAF timer
  useEffect(()=>{
    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current)
      return
    }
    startRef.current = performance.now() - playhead*1000
    const tick = () => {
      const now = performance.now()
      const t = (now - startRef.current)/1000
      setPlayhead(Math.min(t, duration))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying])

  const playPause = () => setIsPlaying(p=>!p)
  const stop = () => { setIsPlaying(false); setPlayhead(0) }

  const onTimelineClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const t = x / zoom
    setPlayhead(Math.max(0, Math.min(duration, t)))
  }

  const renderProject = async () => {
    if (!project) return
    setStatus('Rendering...')
    const res = await authFetch(`${API}/api/v1/projects/${project.id}/render`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ preset, renditions:['1080p'] }) })
    if (res?.job?.id) {
      const id = res.job.id
      setStatus(`Render started (job ${id})`)
      const tk = (token || '').replace(/^Bearer\s+/, '')
      const ev = new EventSource(`${API}/api/v1/jobs/${id}/events?token=${encodeURIComponent(tk)}`)
      ev.addEventListener('progress', (msg)=> {
        try { const data = JSON.parse(msg.data); setStatus(`Rendering... ${data.time || ''}`) } catch {}
      })
      ev.addEventListener('ping', ()=>{/*keep alive*/})
      ev.onerror = ()=> { ev.close() }
    }
    if (res?.output) setStatus(`Done: ${API}${res.output}`)
  }

  const pxPerSec = zoom
  const totalWidth = Math.max(timelineWidth, duration*pxPerSec + 200)

  const addTrack = (type) => {
    const next = { ...project, tracks:[...project.tracks, { id: crypto.randomUUID(), type, name: (type==='video'?'V':'A')+(project.tracks.length+1), clips: [] }] }
    setProject(next)
    saveTimeline(next)
  }

  // Views
  if (view==='login') return (
    <div className="app" style={{ gridTemplateRows: `56px 1fr ${timelineHeight}px` }}>
      <header>
        <div className="row">
          <strong>Video Editor</strong>
        </div>
      </header>
      <div style={{display:'grid', placeItems:'center'}}>
        <div style={{display:'flex', gap:12, padding:24}}>
          {serverConfig?.features?.useCognito ? (
            <button className="btn" onClick={loginWithCognito}>Login with Cognito</button>
          ) : (
            <>
              <input id="u" placeholder="username" />
              <input id="p" placeholder="password" type="password"/>
              <button className="btn" onClick={()=>login(document.getElementById('u').value, document.getElementById('p').value)}>Login</button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="app" style={{ gridTemplateRows: `56px 1fr ${timelineHeight}px` }}>
      <header>
        <div className="row">
          <strong>Video Editor</strong>
          {user && <>
            <span className="tag">user: {user.username}</span>
            <span className="tag">role: {user.role}</span>
            <button className="btn" onClick={logout}>Logout</button>
          </>}
          <span style={{marginLeft:16}}>Zoom:</span>
          <input type="range" min="10" max="200" value={zoom} onChange={e=>setZoom(parseInt(e.target.value))} />
          <button className="btn" onClick={createProject} disabled={!user}>New Project</button>
          <span className="tag">Preset</span>
          <select value={preset} onChange={(e)=>setPreset(e.target.value)}>
            <option value="fast">Fast</option>
            <option value="medium">Medium</option>
            <option value="quality">Quality</option>
          </select>
          <select onChange={(e)=> setProject(projects.find(p=>p.id===e.target.value))} value={project?.id || ''}>
            <option value="">Select project</option>
            {projects.map(p=> <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="tag">Playhead: {secondsToTime(playhead)}</span>
          <button className="btn" onClick={playPause} disabled={!project}>{isPlaying?'Pause':'Play'}</button>
          <button className="btn" onClick={stop} disabled={!project}>Stop</button>
          <button className="btn" onClick={renderProject} disabled={!project}>Render</button>
          <span>{status}</span>
        </div>
      </header>

      <div className="main">
        <div className="sidebar">
          <h3>Library</h3>
          <input type="file" multiple onChange={onUpload} disabled={!user} />
          <div style={{marginTop:12}}>
            {files.map(f=>(
              <div key={f.id} className="library-item" onClick={()=> {
                // add to first matching track type at playhead
                const idx = project?.tracks.findIndex(t=> t.type === (f.mimetype.startsWith('audio') ? 'audio' : 'video')) ?? -1
                if (idx>=0) addClip(idx, f)
              }}>
                <div style={{display:'flex', justifyContent:'space-between'}}>
                  <strong style={{maxWidth:160, overflow:'hidden', textOverflow:'ellipsis'}}>{f.name}</strong>
                  <span className="tag">{f.mimetype}</span>
                </div>
                <div style={{fontSize:12, color:'#aaa'}}>id: {f.id}</div>
              </div>
            ))}
          </div>
        </div>

  <div className="preview">
          <div className="video-stage" ref={stageRef} style={{
            width:'100%',
            height:'auto',
            aspectRatio: project ? `${project.width||1920} / ${project.height||1080}` : '16 / 9',
            position:'relative'
          }}>
            {project?.tracks.filter(t=>t.type==='video').map((t, ti)=> t.clips.map(c=> {
              const file = files.find(f=>f.id===c.fileId)
              if (!file) return null
              const visible = playhead >= c.start && playhead <= c.start + (c.out - c.in)
              const current = Math.max(0, Math.min((playhead - c.start) + c.in, c.out))
              const tok = (token || '').replace(/^Bearer\s+/,'')
              const previewUrl = `${API}/api/v1/preview?fileId=${file.id}&h=360&token=${encodeURIComponent(tok)}`
        return <video key={c.id} className="stage-layer" src={previewUrl} muted
                style={{display: visible? 'block':'none' }}
                onLoadedMetadata={e=> e.currentTarget.currentTime = current}
                ref={el=> { if (el && visible) el.currentTime = current }}
              />
            }))}
          </div>
        </div>
      </div>

      {/* Splitter */}
      <div style={{height:'6px', cursor:'row-resize', background:'#15181c', borderTop:'1px solid #222', borderBottom:'1px solid #111'}}
        onMouseDown={(e)=> { resizingRef.current = { startY: e.clientY, startH: timelineHeight }; const onMove = (ev)=>{
            if (!resizingRef.current) return; const dy = ev.clientY - resizingRef.current.startY; setTimelineHeight(Math.max(100, Math.min(400, resizingRef.current.startH - dy))) }
          ; const onUp = ()=>{ resizingRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) };
          window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
        }}
      />

      <div className="timeline" style={{height: '100%'}}>
        <div className="ruler" style={{overflow:'hidden', position:'relative'}}>
          <div ref={rulerInnerRef} style={{width: totalWidth+'px', transform:`translateX(${-rulerOffset}px)`, willChange:'transform'}}>
            {[...Array(Math.ceil(duration)+1)].map((_,i)=> (
              <div key={i}>
                <div className="tick" style={{left: (i*pxPerSec)+'px', height:'100%'}}></div>
                <div className="label" style={{left: (i*pxPerSec)+'px'}}>{i}s</div>
              </div>
            ))}
            <div className="playhead" style={{left: (playhead*pxPerSec)+'px'}}></div>
          </div>
        </div>
  <div className="tracks" ref={tracksRef} style={{overflowX:'auto', overflowY:'auto', userSelect:'none'}}
          onScroll={(e)=> { const x = e.currentTarget.scrollLeft; rulerOffsetRef.current = x; setRulerOffset(x) }}
          onMouseDown={(e)=> {
            const target = e.target.closest('.clip')
            if (!target) return
            const clipId = target.dataset.id
            const trackIndex = parseInt(target.dataset.ti)
            const clipIndex = parseInt(target.dataset.ci)
            dragRef.current = { startX: e.clientX, startY: e.clientY, origStart: project.tracks[trackIndex].clips[clipIndex].start, clipId, trackIndex, clipIndex, hoverTrack: trackIndex }
          }}
          onMouseMove={(e)=> {
            if (!dragRef.current) return
            const dx = e.clientX - dragRef.current.startX
            const dt = dx / pxPerSec
            const p = JSON.parse(JSON.stringify(projectRef.current || project))
            const { trackIndex, clipIndex, origStart } = dragRef.current
            p.tracks[trackIndex].clips[clipIndex].start = Math.max(0, origStart + dt)
            // detect hovered track by Y
            if (tracksInnerRef.current) {
              const rect = tracksInnerRef.current.getBoundingClientRect()
              const y = e.clientY - rect.top
              const trackH = 64
              const newTi = Math.max(0, Math.min(p.tracks.length-1, Math.floor(y / trackH)))
              dragRef.current.hoverTrack = newTi
            }
            projectRef.current = p
            setProject(p)
          }}
          onMouseUp={()=> {
            if (!dragRef.current) return
            const p = JSON.parse(JSON.stringify(projectRef.current || project))
            const { trackIndex, clipIndex, hoverTrack } = dragRef.current
            if (hoverTrack != null && hoverTrack !== trackIndex) {
              const clip = p.tracks[trackIndex].clips[clipIndex]
              const targetTrack = p.tracks[hoverTrack]
              if (targetTrack && targetTrack.type === clip.type) {
                // move clip to target track
                p.tracks[trackIndex].clips.splice(clipIndex,1)
                p.tracks[hoverTrack].clips.push(clip)
              }
            }
            projectRef.current = p
            setProject(p)
            saveTimeline(p)
            dragRef.current = null
          }}
        >
          <div ref={tracksInnerRef} style={{width: totalWidth+'px'}} onClick={onTimelineClick}>
            {!project && <div style={{padding:12}}>Create/select a project to start.</div>}
            {project && <>
              {project.tracks.map((t, ti)=> (
                <div key={t.id} className="track">
                  <div className="tag" style={{position:'absolute', left:8, top:8}}>{t.name} ({t.type})</div>
                  {t.clips.map((c, ci)=> {
                    const left = c.start * pxPerSec
                    const width = (c.out - c.in) * pxPerSec
                    return (
                      <div key={c.id} data-id={c.id} data-ti={ti} data-ci={ci} className={`clip ${t.type}`} style={{ left: left+'px', width: width+'px' }} title={`${c.name} ${secondsToTime(c.in)}-${secondsToTime(c.out)}`}>
                        <div className="name">{c.name}</div>
                      </div>
                    )
                  })}
                </div>
              ))}
              <div style={{display:'flex', gap:8, padding:'8px 12px'}}>
                <button className="btn" onClick={()=>addTrack('video')}>+ Video Track</button>
                <button className="btn" onClick={()=>addTrack('audio')}>+ Audio Track</button>
              </div>
            </>}
          </div>
        </div>
      </div>
    </div>
  )
}
