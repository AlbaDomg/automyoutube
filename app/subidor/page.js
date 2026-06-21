"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import styles from "../page.module.css";
import Navbar from "../components/Navbar";

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
  const [currentUserRole, setCurrentUserRole] = useState("PRODUCTORA");
  const [channel, setChannel] = useState({ connected: false, channel: null });

  // Estados del uploader
  const [simpleVideoFile, setSimpleVideoFile] = useState(null);
  const [localExtractedFrame, setLocalExtractedFrame] = useState(null);
  const [simpleTitle, setSimpleTitle] = useState("");
  const [simpleDescription, setSimpleDescription] = useState("");
  const [isSimpleUploading, setIsSimpleUploading] = useState(false);
  const [simpleUploadProgress, setSimpleUploadProgress] = useState(0);
  const [simpleUploadStatus, setSimpleUploadStatus] = useState("");

  // Estados del parser de documentos (PDF/Word)
  const [documentFile, setDocumentFile] = useState(null);
  const [parsedVideos, setParsedVideos] = useState([]);
  const [analyzeProgress, setAnalyzeProgress] = useState("IDLE"); // IDLE, ANALYZING, COMPLETED, FAILED
  const [analyzeError, setAnalyzeError] = useState("");
  const documentInputRef = useRef(null);

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

  const simpleVideoInputRef = useRef(null);
  const hiddenVideoRef = useRef(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [frameTime, setFrameTime] = useState(15);
  const [videoObjectURL, setVideoObjectURL] = useState("");

  // Limpiar URL del objeto de vídeo al desmontar
  useEffect(() => {
    return () => {
      if (videoObjectURL) {
        URL.revokeObjectURL(videoObjectURL);
      }
    };
  }, [videoObjectURL]);

  const handleVideoLoadedMetadata = () => {
    if (hiddenVideoRef.current) {
      const duration = hiddenVideoRef.current.duration;
      setVideoDuration(duration);
      // Por defecto capturamos a los 15 segundos, o a la mitad del vídeo si dura menos de 30 segundos
      const defaultSeek = duration > 30 ? 15 : duration / 2;
      setFrameTime(defaultSeek);
      hiddenVideoRef.current.currentTime = defaultSeek;
    }
  };

  const handleVideoSeeked = () => {
    if (hiddenVideoRef.current) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(hiddenVideoRef.current, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL("image/jpeg", 0.85);
          setLocalExtractedFrame(base64);
          setSimpleUploadStatus("Portada del vídeo capturada correctamente.");
        }
      } catch (err) {
        console.error("Error al extraer fotograma en seeked:", err);
      }
    }
  };

  const handleSliderChange = (e) => {
    const newTime = parseFloat(e.target.value);
    setFrameTime(newTime);
    if (hiddenVideoRef.current) {
      hiddenVideoRef.current.currentTime = newTime;
    }
  };

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
              const userRole = data.user.role || "PRODUCTORA";
              setCurrentUserRole(userRole);

              // Restringir el acceso si no es ADMIN o PRODUCTORA
              if (userRole !== "ADMIN" && userRole !== "PRODUCTORA") {
                setAuthError("No tienes permiso para acceder al flujo de Subidor.");
              }
            }
          } else {
            setIsAuthenticated(true);
            setCurrentUserRole("ADMIN");
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
        
        // Videos activos: subiéndose a YouTube o programados para publicarse
        const active = data.filter(v => v.status === "SCHEDULED" || v.status === "UPLOADING");
        setScheduledUpdates(active);

        // Vídeos ya subidos a YouTube correctamente (COMPLETED con youtubeId)
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

  // ⚠️ Aviso si el usuario intenta cerrar o cambiar de página durante una subida activa
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (!isSimpleUploading) return;
      e.preventDefault();
      // Mensaje estándar (los navegadores modernos ignoran el texto personalizado por seguridad)
      e.returnValue = "⚠️ Hay una subida en curso. Si sales ahora, el vídeo no se subirá. ¿Seguro que quieres salir?";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isSimpleUploading]);



  // Optimizar campos con IA
  const handleOptimizeFieldWithAI = async (text, field, setFieldFn, setLoaderFn) => {
    if (!text || !text.trim()) {
      alert("Introduce algún texto primero para optimizar.");
      return;
    }

    // Si es un título, extraer el sufijo "| NOMBREPROGRAMA" para reañadirlo después de la optimización IA
    let suffix = "";
    let textToOptimize = text;
    if (field === 'title') {
      const pipeIndex = text.lastIndexOf(" | ");
      if (pipeIndex !== -1) {
        suffix = text.substring(pipeIndex); // Ej.: " | Canal Galego"
        textToOptimize = text.substring(0, pipeIndex).trim();
      }
    }

    setLoaderFn(true);
    try {
      const res = await fetch("/api/youtube/optimize-seo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToOptimize, field })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.optimizedText) {
          // Para títulos, reañadir el sufijo del programa si existía
          setFieldFn(data.optimizedText + suffix);
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

  // Manejar cambio del input del archivo de vídeo
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setSimpleVideoFile(file);
    if (!file) {
      setLocalExtractedFrame(null);
      setVideoDuration(0);
      setFrameTime(15);
      return;
    }

    setSimpleUploadStatus("Extrayendo portada del vídeo local...");
    try {
      if (videoObjectURL) {
        URL.revokeObjectURL(videoObjectURL);
      }
      const url = URL.createObjectURL(file);
      setVideoObjectURL(url);
      if (hiddenVideoRef.current) {
        hiddenVideoRef.current.src = url;
        hiddenVideoRef.current.load();
      }
    } catch (err) {
      console.error("Error al iniciar carga de vídeo:", err);
      setSimpleUploadStatus("No se pudo iniciar la carga del vídeo para la captura.");
    }
  };

  // Subida de vídeo directamente a YouTube mediante sesión resumible
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

      // Fase 1: Obtener URL de sesión resumible de YouTube a través de nuestro servidor
      const initRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: simpleTitle,
          description: simpleDescription,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || "video/mp4",
          rawFrameBase64: localExtractedFrame
        })
      });

      if (!initRes.ok) {
        const errData = await initRes.json();
        throw new Error(errData.error || "Error al iniciar la sesión de subida en YouTube.");
      }

      const { uploadUrl, videoId } = await initRes.json();
      setSimpleUploadStatus("Subiendo vídeo directamente a YouTube...");

      // Fase 2: Subir el archivo directamente a YouTube en chunks
      // El archivo va del navegador a YouTube — no pasa por Vercel, sin límite de tamaño
      const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB por chunk directo a YouTube
      let offset = 0;
      let youtubeVideoId = null;

      while (offset < file.size) {
        const chunkEnd = Math.min(offset + CHUNK_SIZE, file.size);
        const chunk = file.slice(offset, chunkEnd);

        const chunkRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Range": `bytes ${offset}-${chunkEnd - 1}/${file.size}`,
            "Content-Type": file.type || "video/mp4"
          },
          body: chunk
        });

        if (chunkRes.status === 200 || chunkRes.status === 201) {
          // Subida completada: YouTube devuelve el objeto del vídeo creado
          const data = await chunkRes.json();
          youtubeVideoId = data.id;
          setSimpleUploadProgress(100);
          break;
        } else if (chunkRes.status === 308) {
          // 308 Resume Incomplete: YouTube confirma el chunk y espera el siguiente
          const rangeHeader = chunkRes.headers.get("Range");
          offset = rangeHeader ? parseInt(rangeHeader.split("-")[1]) + 1 : chunkEnd;
          const progress = Math.round((offset / file.size) * 100);
          setSimpleUploadProgress(progress);
          setSimpleUploadStatus(`Subiendo a YouTube: ${progress}%`);
        } else {
          const errText = await chunkRes.text();
          throw new Error(`Error en la subida a YouTube (${chunkRes.status}): ${errText.substring(0, 200)}`);
        }
      }

      if (!youtubeVideoId) {
        throw new Error("No se recibió el ID de YouTube al finalizar la subida.");
      }

      // Fase 3: Notificar al servidor que la subida completó correctamente
      setSimpleUploadStatus("Registrando vídeo en el sistema...");
      await fetch(`/api/upload?action=complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, youtubeId: youtubeVideoId })
      });

      setSimpleUploadStatus("¡Vídeo subido a YouTube correctamente!");
      alert("Vídeo subido a YouTube como privado. El editor puede procesarlo y publicarlo.");

      // Limpiar formulario
      setSimpleVideoFile(null);
      setLocalExtractedFrame(null);
      setSimpleTitle("");
      setSimpleDescription("");
      if (simpleVideoInputRef.current) simpleVideoInputRef.current.value = "";

      // Refrescar listas
      fetchPrivateVideos();
      fetchScheduledUpdates();

    } catch (err) {
      console.error("Error en la subida a YouTube:", err);
      setSimpleUploadStatus(`Error: ${err.message}`);
      alert(`Error en la subida: ${err.message}`);
    } finally {
      setIsSimpleUploading(false);
      setSimpleUploadProgress(0);
    }
  };

  const handleAnalyzeFile = async (e) => {
    e.preventDefault();
    if (!documentFile) {
      alert("Por favor, selecciona un documento PDF o Word primero.");
      return;
    }

    setAnalyzeProgress("ANALYZING");
    setAnalyzeError("");
    setParsedVideos([]);

    try {
      const formData = new FormData();
      formData.append("file", documentFile);
      formData.append("youtubeVideos", JSON.stringify([]));

      const res = await fetch("/api/youtube/analyze-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Fallo al procesar el documento.");
      }

      setParsedVideos(data.videos || []);
      setAnalyzeProgress("COMPLETED");
    } catch (err) {
      console.error(err);
      setAnalyzeError(err.message);
      setAnalyzeProgress("FAILED");
    }
  };

  const handleRellenarFormulario = (title, description) => {
    setSimpleTitle(title);
    setSimpleDescription(description);
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



  // Unir historial: tareas completadas del editor + vídeos subidos directamente a YouTube por el subidor
  const mergedCompletedItems = useMemo(() => {
    const taskItems = tasks.filter(t => t.status === "COMPLETED").map(t => ({
      id: t.id,
      title: t.title,
      youtubeId: t.youtubeId,
      completedAt: t.completedAt,
      privacyStatus: t.privacyStatus || null,
      isLocal: false
    }));

    // Vídeos subidos a YouTube directamente por el subidor (COMPLETED con youtubeId)
    const videoItems = completedLocalVideos.map(v => ({
      id: v.id,
      title: v.title,
      youtubeId: v.youtubeId,
      completedAt: v.updatedAt,
      privacyStatus: v.privacyStatus || null,
      isLocal: true
    }));

    return [...taskItems, ...videoItems].sort((a, b) => {
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

  if (authError && isAuthenticated) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "radial-gradient(circle at 50% 50%, #0c0f24 0%, #040612 100%)",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "2rem",
        textAlign: "center"
      }}>
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🚫</div>
        <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#f87171" }}>Acceso Denegado</h2>
        <p style={{ color: "#94a3b8", marginTop: "0.5rem", maxWidth: "400px" }}>
          {authError}
        </p>
        <button
          onClick={() => window.location.href = "/"}
          style={{
            marginTop: "1.5rem",
            padding: "0.6rem 1.5rem",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "10px",
            color: "#f8fafc",
            cursor: "pointer",
            fontWeight: "600"
          }}
        >
          Volver al Portal
        </button>
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
      {isAuthenticated && <Navbar userEmail={currentUserEmail} userRole={currentUserRole} />}
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

        {/* Layout en Dos Columnas */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gap: "2rem",
          marginBottom: "2rem",
          alignItems: "stretch"
        }}>
          {/* Columna Izquierda: Importar Escaleta (PDF/Word) */}
          <div className={styles.card} style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "flex-start" }}>
            <h3 style={{ fontSize: "1.25rem", fontWeight: "800", marginBottom: "1.25rem", background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              📄 Procesar Escaleta (PDF o Word)
            </h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem", lineHeight: "1.5" }}>
              Sube la escaleta del programa en formato PDF o Word para detectar automáticamente los títulos y descripciones. Podrás rellenar el formulario de subida con un solo clic.
            </p>

            <form onSubmit={handleAnalyzeFile} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                <label>Documento de Referencia (.pdf, .docx)</label>
                <input
                  type="file"
                  ref={documentInputRef}
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => setDocumentFile(e.target.files[0])}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={analyzeProgress === "ANALYZING"}
                className={styles.btnSubmit}
                style={{
                  background: analyzeProgress === "ANALYZING" ? "#4b5563" : "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                  cursor: analyzeProgress === "ANALYZING" ? "not-allowed" : "pointer"
                }}
              >
                {analyzeProgress === "ANALYZING" ? "Procesando Escaleta..." : "Analizar Documento"}
              </button>
            </form>

            {/* Resultados del análisis */}
            {analyzeProgress === "ANALYZING" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", gap: "1rem" }}>
                <div style={{
                  width: "30px",
                  height: "30px",
                  border: "3px solid rgba(168, 85, 247, 0.1)",
                  borderTop: "3px solid #a855f7",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite"
                }} />
                <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Extrayendo contenido con IA de Gemini...</span>
              </div>
            )}

            {analyzeProgress === "FAILED" && (
              <div style={{
                marginTop: "1.5rem",
                padding: "1rem",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#f87171",
                borderRadius: "12px",
                fontSize: "0.85rem"
              }}>
                ❌ Error al analizar el documento: {analyzeError}
              </div>
            )}

            {analyzeProgress === "COMPLETED" && parsedVideos.length === 0 && (
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                No se detectaron vídeos válidos en el documento. Asegúrate de que contiene textos legibles.
              </div>
            )}

            {analyzeProgress === "COMPLETED" && parsedVideos.length > 0 && (
              <div style={{
                marginTop: "1.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                maxHeight: "350px",
                overflowY: "auto",
                paddingRight: "0.25rem"
              }}>
                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: "600" }}>
                  Se detectaron {parsedVideos.length} vídeos:
                </div>
                {parsedVideos.map((video, idx) => (
                  <div key={idx} style={{
                    padding: "0.85rem",
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.85rem", fontWeight: "600", color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {video.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRellenarFormulario(video.title, video.description)}
                        style={{
                          background: "rgba(168, 85, 247, 0.15)",
                          border: "1px solid rgba(168, 85, 247, 0.3)",
                          color: "#c084fc",
                          padding: "2px 8px",
                          borderRadius: "6px",
                          fontSize: "0.75rem",
                          fontWeight: "600",
                          cursor: "pointer",
                          transition: "0.2s",
                          flexShrink: 0
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(168, 85, 247, 0.25)"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "rgba(168, 85, 247, 0.15)"}
                      >
                        📋 Rellenar
                      </button>
                    </div>
                    {video.programName && (
                      <span style={{
                        fontSize: "0.68rem",
                        color: "#0ea5e9",
                        background: "rgba(14, 165, 233, 0.1)",
                        padding: "1px 6px",
                        borderRadius: "6px",
                        fontWeight: "600",
                        width: "fit-content"
                      }}>
                        Programa: {video.programName}
                      </span>
                    )}
                    <p style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                      lineHeight: "1.4",
                      margin: 0,
                      maxHeight: "60px",
                      overflowY: "auto",
                      background: "rgba(0,0,0,0.15)",
                      padding: "4px 8px",
                      borderRadius: "6px"
                    }}>
                      {video.description}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Columna Derecha: Formulario de Subida */}
          <div className={styles.card} style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "flex-start" }}>
            <h3 style={{ fontSize: "1.25rem", fontWeight: "800", marginBottom: "1.25rem", background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              📤 Subida de Vídeo
            </h3>
            <form onSubmit={handleSimpleVideoUpload} style={{ display: "flex", flexDirection: "column", gap: "1.25rem", flex: 1 }}>
              
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

                  {/* ⚠️ Aviso: no cerrar la página durante la subida */}
                  <style>{`
                    @keyframes warningPulse {
                      0%, 100% { border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.08); }
                      50% { border-color: rgba(239, 68, 68, 0.8); background: rgba(239, 68, 68, 0.18); }
                    }
                  `}</style>
                  <div style={{
                    marginTop: "0.75rem",
                    padding: "0.75rem 1rem",
                    background: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.4)",
                    borderRadius: "10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                    animation: "warningPulse 2s ease-in-out infinite"
                  }}>
                    <span style={{ fontSize: "1.2rem", flexShrink: 0 }}>⚠️</span>
                    <span style={{ fontSize: "0.82rem", color: "#fca5a5", fontWeight: "600", lineHeight: "1.4" }}>
                      <strong style={{ color: "#f87171" }}>¡No cierres esta pestaña!</strong><br />
                      La subida se cancelará si sales o cambias de página. Espera a que llegue al 100%.
                    </span>
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
        </div>

        {/* Cola 1: Borradores en YouTube esperando que el editor los procese */}
        <div className={styles.card} style={{ marginTop: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
            <div>
              <div style={{ fontSize: "0.68rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em", color: "#f59e0b", marginBottom: "0.25rem" }}>Cola 1 · Subidor</div>
              <h3 style={{ fontSize: "1rem", fontWeight: "700", color: "#f8fafc", margin: 0 }}>Borradores · Pendientes de edición</h3>
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.2rem 0 0 0" }}>Vídeos subidos a YouTube como borrador privado. El editor debe completarlos y publicarlos.</p>
            </div>
            <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", padding: "3px 12px", borderRadius: "20px", whiteSpace: "nowrap", flexShrink: 0 }}>
              {privateVideos.length} borrador{privateVideos.length !== 1 ? "es" : ""}
            </span>
          </div>

          {privateVideos.length === 0 ? (
            <div className={styles.emptyState}>
              No hay borradores pendientes. Los vídeos subidos por el subidor aparecerán aquí.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: "320px", overflowY: "auto", paddingRight: "0.25rem" }}>
              {privateVideos.map(video => {
                const videoTitle = video.snippet?.title || video.title || "Sin título";
                const publishedAt = video.snippet?.publishedAt || video.createdAt;
                const ytId = video.id?.videoId || video.id;
                return (
                  <div key={ytId} style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.8rem 1rem",
                    background: "rgba(245,158,11,0.04)",
                    border: "1px solid rgba(245,158,11,0.15)",
                    borderRadius: "10px",
                    gap: "1rem"
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: "0.85rem", fontWeight: "600", color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {videoTitle}
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                        ID YouTube: <code style={{ color: "#94a3b8" }}>{ytId}</code>
                        {publishedAt && <span> · Subido el {formatDate(publishedAt)}</span>}
                      </div>
                    </div>
                    <span style={{
                      fontSize: "0.68rem", fontWeight: "700",
                      color: "#f59e0b", background: "rgba(245,158,11,0.12)",
                      border: "1px solid rgba(245,158,11,0.25)",
                      padding: "2px 9px", borderRadius: "6px", whiteSpace: "nowrap", flexShrink: 0
                    }}>
                      Borrador · Pendiente de edición
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Cola 2: Vídeos en proceso de publicación o programados */}
        {scheduledUpdates.length > 0 && (
          <div className={styles.card} style={{ marginTop: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
              <div>
                <div style={{ fontSize: "0.68rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em", color: "#38bdf8", marginBottom: "0.25rem" }}>Cola 2 · Subidor</div>
                <h3 style={{ fontSize: "1rem", fontWeight: "700", color: "#f8fafc", margin: 0 }}>En proceso de publicación</h3>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "#38bdf8", background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.25)", padding: "3px 12px", borderRadius: "20px", whiteSpace: "nowrap" }}>
                  {scheduledUpdates.length} vídeo{scheduledUpdates.length !== 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  onClick={handleExecuteScheduler}
                  disabled={executingScheduler}
                  className={styles.btnSubmit}
                  style={{ width: "auto", fontSize: "0.72rem", padding: "0.3rem 0.85rem", background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", border: "none", margin: 0, opacity: executingScheduler ? 0.6 : 1, cursor: executingScheduler ? "not-allowed" : "pointer" }}
                >
                  {executingScheduler ? "Ejecutando..." : "Ejecutar ahora"}
                </button>
              </div>
            </div>
            <div className={styles.tasksList}>
              {scheduledUpdates.map(update => (
                <div key={update.id} className={styles.taskCardPending} style={{ borderLeftColor: update.status === "UPLOADING" ? "#38bdf8" : "#f59e0b" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <h4 style={{ fontSize: "0.85rem", margin: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{update.title || "Publicación pendiente"}</h4>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "0.5rem", flexShrink: 0 }}>
                      <span className={styles.statusBadge} style={{
                        background: update.status === "UPLOADING" ? "rgba(56,189,248,0.15)" : "rgba(245,158,11,0.15)",
                        color: update.status === "UPLOADING" ? "#38bdf8" : "#f59e0b",
                        padding: "2px 8px", borderRadius: "12px", fontSize: "0.68rem", whiteSpace: "nowrap"
                      }}>
                        {update.status === "UPLOADING" ? `Subiendo… ${update.uploadProgress || 0}%` : "Programado"}
                      </span>
                      <button
                        type="button"
                        title="Cancelar"
                        onClick={async () => {
                          if (!confirm(`¿Cancelar la publicación de "${update.title || update.youtubeId}"?`)) return;
                          try {
                            const res = await fetch(`/api/videos?id=${update.id}`, { method: "DELETE" });
                            if (res.ok) { fetchScheduledUpdates(); fetchTasks(); }
                            else alert("Error al cancelar.");
                          } catch (err) { console.error(err); }
                        }}
                        style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", borderRadius: "50%", width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "0.7rem", fontWeight: "bold" }}
                      >✕</button>
                    </div>
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.4rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    {update.youtubeId && <span>ID YouTube: <code>{update.youtubeId}</code></span>}
                    {update.scheduledAt && <span>· Programado para: <strong>{formatDate(update.scheduledAt)}</strong></span>}
                    {update.privacyStatus && (
                      <span style={{ color: update.privacyStatus === 'public' ? '#34d399' : '#f87171', background: update.privacyStatus === 'public' ? 'rgba(52,211,153,0.12)' : 'rgba(239,68,68,0.12)', padding: '1px 7px', borderRadius: '8px', fontSize: '0.68rem', fontWeight: '700' }}>
                        {update.privacyStatus === 'public' ? 'Público' : update.privacyStatus === 'unlisted' ? 'Oculto' : 'Privado'}
                      </span>
                    )}
                  </div>
                  {update.status === "UPLOADING" && (
                    <div style={{ marginTop: "0.6rem" }}>
                      <div className={styles.batchSyncProgressOuter} style={{ height: "4px", marginTop: 0 }}>
                        <div className={styles.batchSyncProgressInner} style={{ width: `${update.uploadProgress || 0}%`, background: "linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)", height: "100%" }} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cola 3: Historial de publicaciones */}
        <div className={styles.card} style={{ marginTop: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
            <div>
              <div style={{ fontSize: "0.68rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em", color: "#34d399", marginBottom: "0.25rem" }}>Cola 3 · Subidor</div>
              <h3 style={{ fontSize: "1rem", fontWeight: "700", color: "#f8fafc", margin: 0 }}>Historial de publicaciones</h3>
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.2rem 0 0 0" }}>Vídeos completados y publicados en YouTube.</p>
            </div>
            <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "#34d399", background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.25)", padding: "3px 12px", borderRadius: "20px", whiteSpace: "nowrap", flexShrink: 0 }}>
              {mergedCompletedItems.length} publicado{mergedCompletedItems.length !== 1 ? "s" : ""}
            </span>
          </div>

          {loadingTasks ? (
            <div className={styles.emptyState}>Cargando historial...</div>
          ) : mergedCompletedItems.length === 0 ? (
            <div className={styles.emptyState}>No hay publicaciones registradas todavía.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: "350px", overflowY: "auto", paddingRight: "0.25rem" }}>
              {mergedCompletedItems.map(item => (
                <div key={item.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "0.75rem 1rem",
                  background: "rgba(52,211,153,0.03)", border: "1px solid rgba(52,211,153,0.12)",
                  borderRadius: "10px", gap: "1rem"
                }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: "600", color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title || "Sin título"}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      {item.youtubeId && (
                        <a href={`https://youtube.com/watch?v=${item.youtubeId}`} target="_blank" rel="noopener noreferrer"
                          style={{ color: "#38bdf8", textDecoration: "none", fontWeight: "600" }}>
                          Ver en YouTube ↗
                        </a>
                      )}
                      {item.completedAt && <span>· {formatDate(item.completedAt)}</span>}
                    </div>
                    {/* Estado de privacidad — información crítica para el subidor */}
                    <div style={{ marginTop: "0.4rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: "500" }}>Estado en YouTube:</span>
                      {(() => {
                        const ps = item.privacyStatus;
                        if (ps === 'public') return (
                          <span style={{ fontSize: "0.72rem", fontWeight: "800", color: "#34d399", background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.3)", padding: "2px 10px", borderRadius: "6px" }}>
                            Público
                          </span>
                        );
                        if (ps === 'unlisted') return (
                          <span style={{ fontSize: "0.72rem", fontWeight: "800", color: "#fbbf24", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", padding: "2px 10px", borderRadius: "6px" }}>
                            Oculto (no listado)
                          </span>
                        );
                        if (ps === 'private') return (
                          <span style={{ fontSize: "0.72rem", fontWeight: "800", color: "#f87171", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", padding: "2px 10px", borderRadius: "6px" }}>
                            Privado
                          </span>
                        );
                        return (
                          <span style={{ fontSize: "0.68rem", fontWeight: "600", color: "#94a3b8", background: "rgba(148,163,184,0.1)", border: "1px solid rgba(148,163,184,0.2)", padding: "2px 9px", borderRadius: "6px" }}>
                            Sin dato · Verificar en YouTube
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <button
                    type="button"
                    title="Eliminar del historial"
                    onClick={async () => {
                      try {
                        const deleteUrl = item.isLocal ? `/api/videos?id=${item.id}` : `/api/tasks?id=${item.id}`;
                        const res = await fetch(deleteUrl, { method: 'DELETE' });
                        if (res.ok) { item.isLocal ? fetchScheduledUpdates() : fetchTasks(); }
                        else alert("Error al eliminar del historial.");
                      } catch (err) { console.error(err); }
                    }}
                    className={styles.historyActionBtnDelete}
                  >✕</button>
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
      {/* Elemento de vídeo oculto para extracción de miniaturas */}
      <video
        ref={hiddenVideoRef}
        style={{ display: "none" }}
        preload="auto"
        muted
        playsInline
        onLoadedMetadata={handleVideoLoadedMetadata}
        onSeeked={handleVideoSeeked}
      />
    </main>
  );
}
               
