"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import styles from "../page.module.css";

// Helper para generar UUIDs en contextos de red no seguros
function generateUUID() {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Helper para limpiar saltos de línea al pegar texto desde PDFs u otras fuentes de columnas estrechas
const handleCleanPaste = (e, setValFn) => {
  e.preventDefault();
  const pastedText = e.clipboardData.getData("text");
  if (!pastedText) return;

  const paragraphs = pastedText.split(/\r?\n\s*\r?\n/);
  const cleanedParagraphs = paragraphs.map(p => {
    return p
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  });

  const cleanedText = cleanedParagraphs.join("\n\n");
  const target = e.target;
  const start = target.selectionStart;
  const end = target.selectionEnd;
  const currentValue = target.value;
  const newValue = currentValue.substring(0, start) + cleanedText + currentValue.substring(end);
  
  setValFn(newValue);
  setTimeout(() => {
    target.selectionStart = target.selectionEnd = start + cleanedText.length;
  }, 0);
};

export default function SubidorPage() {
  // Estados de autenticación
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const [authError, setAuthError] = useState("");
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [channel, setChannel] = useState({ connected: false, channel: null });

  // Estados del uploader
  const [simpleVideoFile, setSimpleVideoFile] = useState(null);
  const [localExtractedFrame, setLocalExtractedFrame] = useState(null);
  const [simpleTitle, setSimpleTitle] = useState("");
  const [simpleDescription, setSimpleDescription] = useState("");
  const [isSimpleUploading, setIsSimpleUploading] = useState(false);
  const [simpleUploadProgress, setSimpleUploadProgress] = useState(0);
  const [simpleUploadStatus, setSimpleUploadStatus] = useState("");

  // Estados de optimización IA
  const [isOptimizingSimpleTitle, setIsOptimizingSimpleTitle] = useState(false);
  const [isOptimizingSimpleDesc, setIsOptimizingSimpleDesc] = useState(false);

  // Estados de las colas compartidas
  const [scheduledUpdates, setScheduledUpdates] = useState([]);
  const [executingScheduler, setExecutingScheduler] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [completedLocalVideos, setCompletedLocalVideos] = useState([]);
  const [privateVideos, setPrivateVideos] = useState([]);
  const [localVideosQueue, setLocalVideosQueue] = useState([]);

  const simpleVideoInputRef = useRef(null);

  // Validar estado de autenticación al cargar
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has("error")) {
          const err = urlParams.get("error");
          const emailParam = urlParams.get("email");
          if (err === "unauthorized_email") {
            setAuthError(`O correo ${emailParam || ""} non está na lista de autorizados.`);
          } else {
            setAuthError("Erro ao iniciar sesión con Google.");
          }
          window.history.replaceState({}, document.title, window.location.pathname);
        } else if (urlParams.has("login")) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }

        const res = await window.fetch("/api/auth/me", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setIsAuthRequired(data.required);

          if (data.required) {
            setIsAuthenticated(data.authenticated);
            if (data.authenticated && data.user) {
              setCurrentUserEmail(data.user.email);
            }
          } else {
            setIsAuthenticated(true);
          }
        }
      } catch (err) {
        console.error("Error al validar el estado de autenticación:", err);
      } finally {
        setCheckingAuth(false);
      }
    };
    checkAuthStatus();
  }, []);

  const fetchChannel = async () => {
    try {
      const res = await fetch("/api/channel", { cache: "no-store" });
      const data = await res.json();
      setChannel(data);
    } catch (err) {
      console.error("Error al obtener estado del canal:", err);
    }
  };

  const fetchScheduledUpdates = async () => {
    try {
      const res = await fetch("/api/videos", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        
        // Videos programados
        const active = data.filter(v => v.status === "SCHEDULED" || v.status === "UPLOADING");
        setScheduledUpdates(active);

        // Cola de vídeos locales subidos pendientes de procesar
        const queue = data.filter(v => (v.youtubeId === null || v.youtubeId === "") && v.status !== "UPLOADING" && v.status !== "SCHEDULED");
        setLocalVideosQueue(queue);

        // Vídeos locales completados
        const completed = data.filter(v => v.status === "COMPLETED" && v.youtubeId);
        setCompletedLocalVideos(completed);

        // Auto-ejecutar scheduler si hay videos cuya hora ya ha pasado
        const now = new Date();
        const overdue = active.filter(v => v.status === "SCHEDULED" && v.scheduledAt && new Date(v.scheduledAt) <= now);
        if (overdue.length > 0) {
          console.log(`[Auto-Scheduler] ${overdue.length} video(s) vencido(s). Ejecutando scheduler automáticamente...`);
          try {
            await fetch("/api/cron/scheduler", { cache: "no-store" });
            setTimeout(async () => {
              const res2 = await fetch("/api/videos", { cache: "no-store" });
              if (res2.ok) {
                const data2 = await res2.json();
                setScheduledUpdates(data2.filter(v => v.status === "SCHEDULED" || v.status === "UPLOADING"));
              }
              await fetchTasks();
            }, 2000);
          } catch (cronErr) {
            console.error("[Auto-Scheduler] Error al auto-ejecutar scheduler:", cronErr);
          }
        }
      }
    } catch (err) {
      console.error("Error al obtener cola de actualizaciones programadas:", err);
    }
  };

  const fetchTasks = async (silent = false) => {
    if (!silent) setLoadingTasks(true);
    try {
      const res = await fetch("/api/tasks", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (err) {
      console.error("Error al obtener tareas:", err);
    } finally {
      if (!silent) setLoadingTasks(false);
    }
  };

  const fetchPrivateVideos = async () => {
    try {
      const ytRes = await fetch("/api/youtube/videos", { cache: "no-store" });
      if (ytRes.ok) {
        const activePrivateVideos = await ytRes.json();
        setPrivateVideos(activePrivateVideos);
        return activePrivateVideos;
      }
    } catch (ytErr) {
      console.warn("YouTube video fetch failed:", ytErr.message);
    }
    return [];
  };

  // Carga inicial de datos
  useEffect(() => {
    if (isAuthenticated) {
      fetchChannel();
      fetchTasks();
      fetchScheduledUpdates();
      fetchPrivateVideos();
    }
  }, [isAuthenticated]);

  // Recarga periódica automática (cada 10s)
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      fetchScheduledUpdates();
      fetchTasks(true);
      fetchPrivateVideos();
    }, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Optimizar campos con IA
  const handleOptimizeFieldWithAI = async (text, field, setFieldFn, setLoaderFn) => {
    if (!text || !text.trim()) {
      alert("Introduce algún texto primero para optimizar.");
      return;
    }
    setLoaderFn(true);
    try {
      const res = await fetch("/api/youtube/optimize-seo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, field })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.optimizedText) {
          setFieldFn(data.optimizedText);
        }
      } else {
        const data = await res.json();
        alert(`Fallo al optimizar: ${data.error || "error desconocido"}`);
      }
    } catch (err) {
      console.error(err);
      alert("Error de red al conectar con Gemini.");
    } finally {
      setLoaderFn(false);
    }
  };

  // Extrae un fotograma del vídeo local de forma asíncrona mediante un canvas
  const extractFrameFromLocalFile = (file) => {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      
      const fileUrl = URL.createObjectURL(file);
      video.src = fileUrl;

      let timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout al extraer fotograma del vídeo"));
      }, 15000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        URL.revokeObjectURL(fileUrl);
      };

      video.addEventListener("loadedmetadata", () => {
        const seekTime = Math.min(5, video.duration > 2 ? 5 : video.duration / 2);
        video.currentTime = seekTime;
      });

      video.addEventListener("seeked", () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const base64 = canvas.toDataURL("image/jpeg", 0.85);
            cleanup();
            resolve(base64);
          } else {
            cleanup();
            reject(new Error("No se pudo obtener el contexto 2D del canvas"));
          }
        } catch (err) {
          cleanup();
          reject(err);
        }
      });

      video.addEventListener("error", (err) => {
        cleanup();
        reject(err);
      });
    });
  };

  // Manejar cambio del input del archivo de vídeo
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    setSimpleVideoFile(file);
    if (!file) return;

    setSimpleUploadStatus("Extrayendo portada del vídeo local...");
    try {
      const frameBase64 = await extractFrameFromLocalFile(file);
      setLocalExtractedFrame(frameBase64);
      setSimpleUploadStatus("Fotograma extraído correctamente como portada.");
    } catch (err) {
      console.error("Error al extraer fotograma local:", err);
      setSimpleUploadStatus("No se pudo extraer el fotograma (se usará captura por defecto en YouTube).");
    }
  };

  // Subida de vídeo directa a YouTube (Resumible)
  const handleSimpleVideoUpload = async (e) => {
    e.preventDefault();
    if (!simpleVideoFile) {
      alert("Por favor, selecciona un archivo de vídeo.");
      return;
    }
    if (!simpleTitle.trim()) {
      alert("Por favor, introduce un título para el vídeo.");
      return;
    }

    setIsSimpleUploading(true);
    setSimpleUploadProgress(0);
    setSimpleUploadStatus("Iniciando sesión de subida en YouTube...");

    try {
      const file = simpleVideoFile;

      // 1. Iniciar sesión de subida en el servidor
      const initiateRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: simpleTitle,
          description: simpleDescription,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || "video/mp4",
          rawFrameBase64: localExtractedFrame,
          playlistId: ""
        })
      });

      if (!initiateRes.ok) {
        const errData = await initiateRes.json();
        throw new Error(errData.error || "Fallo al iniciar sesión de subida");
      }

      const { uploadUrl, videoId } = await initiateRes.json();
      setSimpleUploadStatus("Subiendo archivo directamente a YouTube...");

      // 2. Subida directa del archivo (PUT) a YouTube con seguimiento del progreso
      const youtubeId = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");

        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const percent = Math.round((evt.loaded / evt.total) * 100);
            setSimpleUploadProgress(percent);
            setSimpleUploadStatus(`Subiendo archivo a YouTube: ${percent}%...`);
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 201) {
            try {
              const responseJson = JSON.parse(xhr.responseText);
              if (responseJson && responseJson.id) {
                resolve(responseJson.id);
              } else {
                reject(new Error("No se recibió el ID del vídeo de la respuesta de YouTube"));
              }
            } catch (err) {
              reject(new Error("Error al analizar respuesta de YouTube: " + err.message));
            }
          } else {
            reject(new Error(`YouTube rechazó la subida: ${xhr.status} ${xhr.statusText}`));
          }
        };

        xhr.onerror = () => {
          reject(new Error("Error de conexión al subir directamente a YouTube."));
        };

        xhr.send(file);
      });

      // 3. Completar registro en base de datos
      setSimpleUploadStatus("Finalizando registro en base de datos...");
      const completeRes = await fetch("/api/upload?action=complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          youtubeId
        })
      });

      if (!completeRes.ok) {
        const errData = await completeRes.json();
        throw new Error(errData.error || "Fallo al completar subida en base de datos");
      }

      setSimpleUploadStatus("¡Subida completada con éxito!");
      alert("¡Vídeo subido directamente a YouTube con éxito y puesto en cola para los editores!");
      
      // Limpiar formulario y refrescar lista
      setSimpleVideoFile(null);
      setLocalExtractedFrame(null);
      setSimpleTitle("");
      setSimpleDescription("");
      if (simpleVideoInputRef.current) {
        simpleVideoInputRef.current.value = "";
      }
      fetchScheduledUpdates();
    } catch (err) {
      console.error(err);
      setSimpleUploadStatus(`Error: ${err.message}`);
      alert(`Error en la subida: ${err.message}`);
    } finally {
      setIsSimpleUploading(false);
      setSimpleUploadProgress(0);
    }
  };

  const handleExecuteScheduler = async () => {
    setExecutingScheduler(true);
    try {
      const res = await fetch("/api/scheduler", { cache: "no-store" });
      if (res.ok) {
        alert("Sincronizaciones programadas ejecutadas con éxito.");
        await fetchScheduledUpdates();
        await fetchTasks();
      } else {
        const data = await res.json();
        alert(`Error al ejecutar sincronizaciones: ${data.error || "error desconocido"}`);
      }
    } catch (err) {
      console.error("Error executing scheduler:", err);
      alert("Error de red al conectar con el servidor.");
    } finally {
      setExecutingScheduler(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };



  // Unir historial de tareas completadas de YouTube e historial local
  const mergedCompletedItems = useMemo(() => {
    const taskItems = tasks.filter(t => t.status === "COMPLETED").map(t => ({
      id: t.id,
      title: t.title,
      youtubeId: t.youtubeId,
      completedAt: t.completedAt,
      isLocal: false
    }));

    const localItems = completedLocalVideos.map(v => ({
      id: v.id,
      title: v.title,
      youtubeId: v.youtubeId,
      completedAt: v.updatedAt,
      isLocal: true
    }));

    return [...taskItems, ...localItems].sort((a, b) => {
      const dateA = a.completedAt ? new Date(a.completedAt) : new Date(0);
      const dateB = b.completedAt ? new Date(b.completedAt) : new Date(0);
      return dateB - dateA;
    });
  }, [tasks, completedLocalVideos]);

  const handleGoogleLogin = () => {
    window.location.href = "/api/auth/app-login";
  };

  if (checkingAuth) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "radial-gradient(circle at 50% 50%, #0c0f24 0%, #040612 100%)",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif"
      }}>
        <div style={{
          width: "40px",
          height: "40px",
          border: "4px solid rgba(168, 85, 247, 0.1)",
          borderTop: "4px solid #a855f7",
          borderRadius: "50%",
          animation: "spin 1s linear infinite"
        }} />
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}} />
        <p style={{ marginTop: "1rem", color: "#94a3b8", fontSize: "0.9rem" }}>Cargando portal...</p>
      </div>
    );
  }

  if (isAuthRequired && !isAuthenticated) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "radial-gradient(circle at 50% 50%, #0c0f24 0%, #040612 100%)",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "1rem"
      }}>
        <div style={{
          position: "absolute",
          width: "300px",
          height: "300px",
          background: "rgba(168, 85, 247, 0.15)",
          borderRadius: "50%",
          filter: "blur(80px)",
          top: "20%",
          left: "30%",
          zIndex: 1
        }} />
        <div style={{
          position: "absolute",
          width: "300px",
          height: "300px",
          background: "rgba(14, 165, 233, 0.15)",
          borderRadius: "50%",
          filter: "blur(80px)",
          bottom: "20%",
          right: "30%",
          zIndex: 1
        }} />

        <div style={{
          position: "relative",
          zIndex: 2,
          width: "100%",
          maxWidth: "420px",
          background: "rgba(15, 23, 42, 0.45)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "24px",
          padding: "3rem 2rem",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          textAlign: "center"
        }}>
          <h2 style={{ fontSize: "1.75rem", fontWeight: "900", marginBottom: "0.5rem" }}>Benvido a AutomYoutube</h2>
          <p style={{ color: "#94a3b8", fontSize: "0.95rem", marginBottom: "2rem" }}>
            Inicia sesión para poder subir e programar contidos da canle.
          </p>

          {authError && (
            <div style={{
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#f87171",
              borderRadius: "12px",
              padding: "0.75rem 1rem",
              fontSize: "0.85rem",
              marginBottom: "1.5rem",
              textAlign: "left"
            }}>
              ⚠️ {authError}
            </div>
          )}

          <button
            onClick={handleGoogleLogin}
            style={{
              width: "100%",
              padding: "0.85rem 1rem",
              background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
              border: "none",
              borderRadius: "12px",
              color: "#fff",
              fontWeight: "600",
              fontSize: "0.95rem",
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(168, 85, 247, 0.3)",
              transition: "all 0.2s"
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-1px)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "none"}
          >
            🔑 Entrar con Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        {/* Encabezado */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <div>
            <h1 style={{ fontSize: "1.75rem", fontWeight: "900", background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              📤 Flujo de Subidor
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Sube archivos locales y optimiza metadatos básicos
            </p>
          </div>
          <a href="/" style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid var(--border-color)",
            borderRadius: "10px",
            fontSize: "0.8rem",
            fontWeight: "600",
            color: "#f8fafc",
            textDecoration: "none",
            transition: "all 0.2s"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.borderColor = "#a855f7";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
            e.currentTarget.style.borderColor = "var(--border-color)";
          }}
          >
            <span>🏠 Portal Principal</span>
          </a>
        </div>

        {/* Formulario de Subida */}
        <div className={styles.card}>
          <h3 style={{ fontSize: "1.25rem", fontWeight: "800", marginBottom: "1.25rem", background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            📤 Subida de Vídeo
          </h3>
          <form onSubmit={handleSimpleVideoUpload} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            
            <div className={styles.inputGroup}>
              <label>Archivo de vídeo (.mp4, .mov, etc.)</label>
              <input
                type="file"
                ref={simpleVideoInputRef}
                accept="video/*"
                onChange={handleFileChange}
                required
              />
            </div>

            <div className={styles.inputGroup}>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Título en YouTube</span>
                <button
                  type="button"
                  disabled={isOptimizingSimpleTitle}
                  onClick={() => handleOptimizeFieldWithAI(simpleTitle, 'title', setSimpleTitle, setIsOptimizingSimpleTitle)}
                  className={styles.btnSubmit}
                  style={{
                    width: "auto",
                    fontSize: "0.7rem",
                    padding: "2px 8px",
                    margin: 0,
                    background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    color: "#fff"
                  }}
                >
                  {isOptimizingSimpleTitle ? "Optimizando..." : "🪄 Optimizar con IA"}
                </button>
              </label>
              <input
                type="text"
                placeholder="Escribe un título descriptivo..."
                value={simpleTitle}
                onChange={(e) => setSimpleTitle(e.target.value)}
                onPaste={(e) => handleCleanPaste(e, setSimpleTitle)}
                required
              />
              {isOptimizingSimpleTitle && (
                <div style={{
                  marginTop: "0.4rem",
                  height: "3px",
                  width: "100%",
                  backgroundColor: "rgba(255,255,255,0.05)",
                  borderRadius: "1.5px",
                  overflow: "hidden",
                  position: "relative"
                }}>
                  <div className={styles.pulseProgressBar} />
                </div>
              )}
            </div>

            <div className={styles.inputGroup}>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Descripción del vídeo</span>
                <button
                  type="button"
                  disabled={isOptimizingSimpleDesc}
                  onClick={() => handleOptimizeFieldWithAI(simpleDescription, 'description', setSimpleDescription, setIsOptimizingSimpleDesc)}
                  className={styles.btnSubmit}
                  style={{
                    width: "auto",
                    fontSize: "0.7rem",
                    padding: "2px 8px",
                    margin: 0,
                    background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    color: "#fff"
                  }}
                >
                  {isOptimizingSimpleDesc ? "Optimizando..." : "🪄 Optimizar con IA"}
                </button>
              </label>
              <textarea
                rows="6"
                placeholder="Escribe la descripción del vídeo..."
                value={simpleDescription}
                onChange={(e) => setSimpleDescription(e.target.value)}
                onPaste={(e) => handleCleanPaste(e, setSimpleDescription)}
                style={{ fontSize: "0.85rem", lineHeight: "1.4" }}
              />
              {isOptimizingSimpleDesc && (
                <div style={{
                  marginTop: "0.4rem",
                  height: "3px",
                  width: "100%",
                  backgroundColor: "rgba(255,255,255,0.05)",
                  borderRadius: "1.5px",
                  overflow: "hidden",
                  position: "relative"
                }}>
                  <div className={styles.pulseProgressBar} />
                </div>
              )}
            </div>

            {isSimpleUploading && (
              <div style={{ marginTop: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.80rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                  <span>{simpleUploadStatus}</span>
                  <span>{simpleUploadProgress}%</span>
                </div>
                <div className={styles.batchSyncProgressOuter} style={{ marginTop: 0 }}>
                  <div
                    className={styles.batchSyncProgressInner}
                    style={{
                      width: `${simpleUploadProgress}%`,
                      background: "linear-gradient(90deg, #a855f7 0%, #ec4899 100%)",
                      boxShadow: "0 0 8px rgba(168, 85, 247, 0.4)"
                    }}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSimpleUploading}
              className={styles.btnSubmit}
              style={{
                marginTop: "0.5rem",
                background: isSimpleUploading ? "#4b5563" : "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                cursor: isSimpleUploading ? "not-allowed" : "pointer"
              }}
            >
              {isSimpleUploading ? "Subiendo vídeo..." : "Subir vídeo a la cola"}
            </button>
          </form>
        </div>

        {/* 1. Cola de Vídeos Locales subidos pendientes de procesar */}
        <div className={styles.card} style={{ marginTop: "1.5rem" }}>
          <div className={styles.cardTitle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>⏳ Cola de Vídeos Pendientes</span>
            <span style={{
              fontSize: "0.75rem",
              color: "#a855f7",
              background: "rgba(168, 85, 247, 0.15)",
              padding: "2px 8px",
              borderRadius: "10px",
              fontWeight: "bold"
            }}>
              {localVideosQueue.length} vídeos
            </span>
          </div>

          {localVideosQueue.length === 0 ? (
            <div className={styles.emptyState}>
              No hay vídeos locales pendientes de procesar.
            </div>
          ) : (
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              maxHeight: "350px",
              overflowY: "auto",
              paddingRight: "0.25rem"
            }}>
              {localVideosQueue.map(video => (
                <div key={video.id} style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.75rem 1rem",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "12px",
                  gap: "1rem"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "1.5rem" }}>🎬</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: "0.85rem", fontWeight: "600", color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {video.title || "Sin título"}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                        Archivo: <code>{video.filename}</code> | Creado: {formatDate(video.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <button
                      type="button"
                      title="Eliminar vídeo de la cola"
                      onClick={async () => {
                        if (!window.confirm(`¿Eliminar "${video.title || video.filename}" de la cola?`)) return;
                        try {
                          const res = await fetch(`/api/videos?id=${video.id}`, { method: "DELETE" });
                          if (res.ok) {
                            fetchScheduledUpdates();
                          } else {
                            alert("Error al eliminar el vídeo.");
                          }
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                      style={{
                        background: "rgba(239, 68, 68, 0.15)",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        color: "#ef4444",
                        borderRadius: "50%",
                        width: "26px",
                        height: "26px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                        fontWeight: "bold",
                        flexShrink: 0
                      }}
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 2. Actualizaciones locales programadas activas */}
        {scheduledUpdates.length > 0 && (
          <div className={styles.card} style={{ marginTop: "1.5rem" }}>
            <div className={styles.cardTitle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Videos Pendientes de Sincronización(Programados)</span>
              <button
                type="button"
                onClick={handleExecuteScheduler}
                disabled={executingScheduler}
                className={styles.btnSubmit}
                style={{
                  width: "auto",
                  fontSize: "0.75rem",
                  padding: "0.3rem 0.75rem",
                  background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                  border: "none",
                  margin: 0,
                  opacity: executingScheduler ? 0.6 : 1,
                  cursor: executingScheduler ? "not-allowed" : "pointer"
                }}
              >
                {executingScheduler ? "Ejecutando..." : "⚡ Ejecutar Programados Ahora"}
              </button>
            </div>
            <div className={styles.tasksList}>
              {scheduledUpdates.map(update => (
                <div key={update.id} className={styles.taskCardPending} style={{ borderLeftColor: update.status === "UPLOADING" ? "#10b981" : "#f59e0b" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <h4 style={{ fontSize: "0.85rem", margin: 0, flex: 1 }}>{update.title || "Actualización pendiente"}</h4>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "0.5rem" }}>
                      <span className={styles.statusBadge} style={{
                        background: update.status === "UPLOADING" ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
                        color: update.status === "UPLOADING" ? "#10b981" : "#f59e0b",
                        padding: "2px 8px",
                        borderRadius: "12px",
                        fontSize: "0.7rem",
                        whiteSpace: "nowrap"
                      }}>
                        {update.status === "UPLOADING"
                          ? `Subiendo... ${update.uploadProgress || 0}%`
                          : (update.status === "SCHEDULED" ? "Programada" : "Aplicando...")}
                      </span>
                      <button
                        type="button"
                        title="Cancelar programación"
                        onClick={async () => {
                          if (!confirm(`¿Cancelar la sincronización programada de "${update.title || update.youtubeId}"?`)) return;
                          try {
                            const res = await fetch(`/api/videos?id=${update.id}`, { method: "DELETE" });
                            if (res.ok) {
                              fetchScheduledUpdates();
                              fetchTasks();
                            } else {
                              const data = await res.json();
                              alert("Error al cancelar: " + (data.error || "error desconocido"));
                            }
                          } catch (err) {
                            console.error(err);
                            alert("Error de red al cancelar la programación.");
                          }
                        }}
                        style={{
                          background: "rgba(239, 68, 68, 0.15)",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          color: "#ef4444",
                          borderRadius: "50%",
                          width: "22px",
                          height: "22px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          fontSize: "0.7rem",
                          fontWeight: "bold",
                          flexShrink: 0
                        }}
                      >✕</button>
                    </div>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.4rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <strong>ID YouTube:</strong> <code>{update.youtubeId || "En creación..."}</code> |{' '}
                    <strong>Ejecución:</strong> {formatDate(update.scheduledAt)} |{' '}
                    <strong>Destino:</strong>{' '}
                    {(() => {
                      const isPub = update.privacyStatus === 'public';
                      return (
                        <span style={{
                          color: isPub ? '#34d399' : '#f87171',
                          background: isPub ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          padding: '1px 6px',
                          borderRadius: '8px',
                          fontSize: '0.7rem',
                          fontWeight: 'bold'
                        }}>
                          {isPub ? 'Público' : 'Privado'}
                        </span>
                      );
                    })()}
                  </div>
                  {update.status === "UPLOADING" && (
                    <div style={{ marginTop: "0.75rem" }}>
                      <div className={styles.batchSyncProgressOuter} style={{ height: "6px", marginTop: 0 }}>
                        <div
                          className={styles.batchSyncProgressInner}
                          style={{
                            width: `${update.uploadProgress || 0}%`,
                            background: "linear-gradient(90deg, #10b981 0%, #3b82f6 100%)",
                            boxShadow: "0 0 8px rgba(16, 185, 129, 0.4)",
                            height: "100%"
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Historial de Sincronizaciones Realizadas */}
        <div className={styles.card} style={{ marginTop: "1.5rem" }}>
          <div className={styles.cardTitle}>Historial: Sincronizaciones Realizadas</div>

          {loadingTasks ? (
            <div className={styles.emptyState}>Cargando tareas...</div>
          ) : mergedCompletedItems.length === 0 ? (
            <div className={styles.emptyState}>No hay videos sincronizados recientemente.</div>
          ) : (
            <div className={styles.tasksList}>
              {mergedCompletedItems.map(item => (
                <div key={item.id} className={styles.taskCardCompleted}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                    <h4 className={styles.taskCardTitle} style={{ textDecoration: "line-through", color: "var(--text-muted)", flex: 1 }}>
                      {item.title}
                    </h4>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const deleteUrl = item.isLocal ? `/api/videos?id=${item.id}` : `/api/tasks?id=${item.id}`;
                          const res = await fetch(deleteUrl, { method: 'DELETE' });
                          if (res.ok) {
                            if (item.isLocal) {
                              fetchScheduledUpdates();
                            } else {
                              fetchTasks();
                            }
                          } else {
                            alert("Error al eliminar la tarea del historial local.");
                          }
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                      className={styles.historyActionBtnDelete}
                    >✕</button>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "0.5rem" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      <div><strong>ID YouTube:</strong> <code>{item.youtubeId}</code></div>
                      {item.completedAt && (
                        <div><strong>Sincronizado el:</strong> {formatDate(item.completedAt)}</div>
                      )}
                      <div style={{ marginTop: "0.2rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        <strong>Privacidad:</strong>
                        {(() => {
                          const ytVid = privateVideos.find(v => v.id === item.youtubeId);
                          if (ytVid) {
                            const isPrivate = ytVid.privacyStatus === 'private';
                            return (
                              <span style={{
                                color: isPrivate ? '#f87171' : '#fbbf24',
                                background: isPrivate ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                padding: '1px 6px',
                                borderRadius: '8px',
                                fontSize: '0.7rem',
                                fontWeight: 'bold'
                              }}>
                                {isPrivate ? 'Privado' : 'Oculto'}
                              </span>
                            );
                          }
                          return (
                            <span style={{
                              color: '#34d399',
                              background: 'rgba(52, 211, 153, 0.15)',
                              padding: '1px 6px',
                              borderRadius: '8px',
                              fontSize: '0.7rem',
                              fontWeight: 'bold'
                            }}>
                              Público
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    <a
                      href={`https://studio.youtube.com/video/${item.youtubeId}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.btnSubmit}
                      style={{
                        width: "auto",
                        fontSize: "0.75rem",
                        padding: "0.3rem 0.75rem",
                        background: "#0284c7",
                        border: "none",
                        textDecoration: "none",
                        color: "#fff",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        borderRadius: "4px",
                        fontWeight: "500",
                        height: "fit-content"
                      }}
                    >
                      ✏️ Editar en YouTube
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer/Info del Trabajador */}
        {currentUserEmail && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: "2.5rem", fontSize: "0.75rem", color: "var(--text-muted)", gap: "0.5rem" }}>
            <span>Sesión activa como:</span>
            <strong style={{ color: "var(--text-secondary)" }}>{currentUserEmail}</strong>
          </div>
        )}
      </div>
    </main>
  );
}
