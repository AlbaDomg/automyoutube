"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import styles from "../page.module.css";
import Navbar from "../components/Navbar";
import DateTimePicker from "@/components/DateTimePicker";

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

const toUTCISOString = (localDateTimeStr) => {
  if (!localDateTimeStr) return null;
  return new Date(localDateTimeStr).toISOString();
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
  const [loadingChannel, setLoadingChannel] = useState(true);
  const [config, setConfig] = useState({ isConfigured: false });

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
  const [dbVideos, setDbVideos] = useState([]);

  const simpleVideoInputRef = useRef(null);
  const hiddenVideoRef = useRef(null);
  const autoSchedulerRunningRef = useRef(false);
  const hasMatchedRef = useRef(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [frameTime, setFrameTime] = useState(15);
  const [videoObjectURL, setVideoObjectURL] = useState("");

  // Estados de la cola de subidas por lote
  const [batchFiles, setBatchFiles] = useState([]);
  const [extractingIndex, setExtractingIndex] = useState(-1);
  const [isBatchUploading, setIsBatchUploading] = useState(false);
  const [optimizingBatchFields, setOptimizingBatchFields] = useState({});

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

  const handleVideoSeeked = async () => {
    if (hiddenVideoRef.current) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(hiddenVideoRef.current, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL("image/jpeg", 0.85);

          if (extractingIndex >= 0) {
            const currentIdx = extractingIndex;
            await processExtractionResult(currentIdx, base64);
          } else {
            setLocalExtractedFrame(base64);
            setSimpleUploadStatus("Portada del vídeo capturada correctamente.");
          }
        }
      } catch (err) {
        console.error("Error al extraer fotograma en seeked:", err);
        if (extractingIndex >= 0) {
          const currentIdx = extractingIndex;
          setBatchFiles(prev => prev.map((item, idx) => 
            idx === currentIdx ? { ...item, status: 'ready' } : item
          ));
          setExtractingIndex(-1);
        }
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
            setAuthError("Error al iniciar sesión con Google.");
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

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      console.error("Error al obtener la configuración:", err);
    }
  };

  const fetchChannel = async () => {
    setLoadingChannel(true);
    try {
      const res = await fetch("/api/channel", { cache: "no-store" });
      const data = await res.json();
      setChannel(data);
    } catch (err) {
      console.error("Error al obtener estado del canal:", err);
    } finally {
      setLoadingChannel(false);
    }
  };

  const disconnectChannel = async () => {
    if (window.confirm("¿Estás seguro de que deseas desconectar el canal?")) {
      try {
        const res = await fetch("/api/channel", { method: "DELETE" });
        if (res.ok) {
          alert("Canal desconectado con éxito.");
          fetchChannel();
        } else {
          const data = await res.json();
          alert(`Error al desconectar: ${data.error || "error desconocido"}`);
        }
      } catch (err) {
        console.error(err);
        alert("Error de red al intentar desconectar.");
      }
    }
  };

  const fetchScheduledUpdates = async () => {
    try {
      const res = await fetch("/api/videos", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setDbVideos(data);
        
        // Videos activos: subiéndose a YouTube o programados para publicarse
        const activeMap = new Map();
        data
          .filter(v => v.status === "SCHEDULED" || v.status === "UPLOADING")
          .forEach(v => {
            const key = v.youtubeId || v.id;
            const prev = activeMap.get(key);
            if (!prev || new Date(v.updatedAt || v.createdAt || 0) > new Date(prev.updatedAt || prev.createdAt || 0)) {
              activeMap.set(key, v);
            }
          });
        const active = Array.from(activeMap.values());
        setScheduledUpdates(active);

        // Vídeos ya subidos a YouTube correctamente (COMPLETED con youtubeId)
        const completed = data.filter(v => v.status === "COMPLETED" && v.youtubeId);
        setCompletedLocalVideos(completed);

        // Auto-ejecutar scheduler si hay videos cuya hora ya ha pasado
        const now = new Date();
        const overdue = active.filter(v => v.status === "SCHEDULED" && v.scheduledAt && new Date(v.scheduledAt) <= now);
        if (overdue.length > 0 && !autoSchedulerRunningRef.current) {
          autoSchedulerRunningRef.current = true;
          console.log(`[Auto-Scheduler] ${overdue.length} video(s) vencido(s). Ejecutando scheduler automáticamente...`);
          try {
            await fetch("/api/scheduler", { cache: "no-store" });
            setTimeout(async () => {
              const res2 = await fetch("/api/videos", { cache: "no-store" });
              if (res2.ok) {
                const data2 = await res2.json();
                setDbVideos(data2);
                setScheduledUpdates(data2.filter(v => v.status === "SCHEDULED" || v.status === "UPLOADING"));
              }
              await fetchTasks(true);
              autoSchedulerRunningRef.current = false;
            }, 2000);
          } catch (cronErr) {
            console.error("[Auto-Scheduler] Error al auto-ejecutar scheduler:", cronErr);
            autoSchedulerRunningRef.current = false;
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
      fetchConfig();
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

  // Manejar cambio del input del archivo de vídeo (múltiple)
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const newBatchItems = files.map(file => ({
      id: generateUUID(),
      file: file,
      title: file.name.replace(/\.[^/.]+$/, ""),
      description: "",
      status: 'pending', // pending, extracting, ready, uploading, completed, failed
      progress: 0,
      rawFrameBase64: null,
      hasMatched: false,
      index: null,
      scheduledAt: ""
    }));

    setBatchFiles(prev => [...prev, ...newBatchItems]);

    // Limpiar input
    if (e.target) {
      e.target.value = "";
    }
  };

  // Actualizar metadatos de un vídeo en la cola
  const handleUpdateBatchField = (id, field, value) => {
    setBatchFiles(prev => prev.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  // Eliminar un vídeo de la cola
  const handleRemoveBatchFile = (id) => {
    setBatchFiles(prev => {
      const isExtractingItemRemoved = prev.find(item => item.id === id)?.status === 'extracting';
      if (isExtractingItemRemoved) {
        setExtractingIndex(-1);
        if (videoObjectURL) {
          URL.revokeObjectURL(videoObjectURL);
          setVideoObjectURL("");
        }
      }
      return prev.filter(item => item.id !== id);
    });
  };

  // Procesar el fotograma extraído
  const processExtractionResult = async (idx, base64) => {
    setBatchFiles(prev => {
      const item = prev[idx];
      if (!item) {
        setExtractingIndex(-1);
        return prev;
      }

      // Limpiar videoObjectURL
      if (videoObjectURL) {
        URL.revokeObjectURL(videoObjectURL);
        setVideoObjectURL("");
      }

      setTimeout(() => setExtractingIndex(-1), 0);
      return prev.map((it, i) => 
        i === idx ? { ...it, rawFrameBase64: base64, status: 'ready' } : it
      );
    });
  };


  // Efecto para procesar secuencialmente la extracción de portadas de la cola
  useEffect(() => {
    if (extractingIndex !== -1) return;

    const pendingIdx = batchFiles.findIndex(item => item.status === 'pending');
    if (pendingIdx !== -1) {
      setExtractingIndex(pendingIdx);
      
      setBatchFiles(prev => prev.map((item, idx) => 
        idx === pendingIdx ? { ...item, status: 'extracting' } : item
      ));

      const file = batchFiles[pendingIdx].file;
      try {
        const url = URL.createObjectURL(file);
        setVideoObjectURL(url);
        if (hiddenVideoRef.current) {
          hiddenVideoRef.current.src = url;
          hiddenVideoRef.current.load();
        }
      } catch (err) {
        console.error("Error al cargar vídeo para extraer en cola:", err);
        setBatchFiles(prev => prev.map((item, idx) => 
          idx === pendingIdx ? { ...item, status: 'failed' } : item
        ));
        setExtractingIndex(-1);
      }
    }
  }, [batchFiles, extractingIndex]);


  // Subir un único vídeo de la cola usando chunks
  const uploadSingleBatchVideo = async (item) => {
    const file = item.file;

    // Fase 1: Obtener URL de sesión resumible
    const initRes = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: item.title,
        description: item.description,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || "video/mp4",
        rawFrameBase64: item.rawFrameBase64,
        scheduledAt: item.scheduledAt ? toUTCISOString(item.scheduledAt) : null
      })
    });

    if (!initRes.ok) {
      const errData = await initRes.json();
      throw new Error(errData.error || "Error al iniciar la sesión de subida en YouTube.");
    }

    const { uploadUrl, videoId } = await initRes.json();

    setScheduledUpdates(prev => [
      {
        id: videoId,
        title: item.title,
        description: item.description,
        status: "UPLOADING",
        uploadProgress: 0,
        filePath: "YOUTUBE_UPLOAD"
      },
      ...prev.filter(it => it.id !== videoId)
    ]);

    // Fase 2: Subir chunked
    const CHUNK_SIZE = 5 * 1024 * 1024;
    let offset = 0;
    let youtubeVideoId = null;
    let lastPersistedProgress = -1;
    let lastPersistedAt = 0;

    const persistUploadProgress = (percent, force = false) => {
      const progress = Math.max(0, Math.min(100, Math.round(percent)));
      
      setBatchFiles(prev => prev.map(it => 
        it.id === item.id ? { ...it, progress } : it
      ));

      setScheduledUpdates(prev => prev.map(it =>
        it.id === videoId ? { ...it, status: "UPLOADING", uploadProgress: progress } : it
      ));

      const now = Date.now();
      if (!force && progress < 100 && progress - lastPersistedProgress < 5 && now - lastPersistedAt < 1000) {
        return;
      }
      lastPersistedProgress = progress;
      lastPersistedAt = now;
      fetch(`/api/videos?id=${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadProgress: progress })
      }).catch(progressErr => {
        console.warn("[Batch Upload Progress] Failed to persist progress:", progressErr);
      });
    };

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
        const data = await chunkRes.json();
        youtubeVideoId = data.id;
        persistUploadProgress(100, true);
        break;
      } else if (chunkRes.status === 308) {
        const rangeHeader = chunkRes.headers.get("Range");
        offset = rangeHeader ? parseInt(rangeHeader.split("-")[1]) + 1 : chunkEnd;
        const progress = Math.round((offset / file.size) * 100);
        persistUploadProgress(progress);
      } else {
        const errText = await chunkRes.text();
        throw new Error(`Error en la subida a YouTube (${chunkRes.status}): ${errText.substring(0, 200)}`);
      }
    }

    if (!youtubeVideoId) {
      throw new Error("No se recibió el ID de YouTube al finalizar la subida.");
    }

    // Fase 3: Completar registro
    await fetch(`/api/upload?action=complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, youtubeId: youtubeVideoId })
    });
  };

  // Iniciar la subida de todos los vídeos listos secuencialmente
  const handleStartBatchUpload = async () => {
    if (isBatchUploading) return;
    
    const readyItems = batchFiles.filter(item => item.status === 'ready' || item.status === 'failed');
    if (readyItems.length === 0) {
      alert("No hay vídeos listos para subir en la cola.");
      return;
    }

    setIsBatchUploading(true);

    for (const item of readyItems) {
      let exists = false;
      await new Promise(resolve => {
        setBatchFiles(prev => {
          const fresh = prev.find(it => it.id === item.id);
          exists = fresh && (fresh.status === 'ready' || fresh.status === 'failed');
          resolve();
          return prev;
        });
      });
      if (!exists) continue;

      try {
        setBatchFiles(prev => prev.map(it => 
          it.id === item.id ? { ...it, status: 'uploading', progress: 0 } : it
        ));

        await uploadSingleBatchVideo(item);

        setBatchFiles(prev => prev.map(it => 
          it.id === item.id ? { ...it, status: 'completed', progress: 100 } : it
        ));
      } catch (err) {
        console.error(`Error al subir ${item.file.name}:`, err);
        setBatchFiles(prev => prev.map(it => 
          it.id === item.id ? { ...it, status: 'failed' } : it
        ));
      }
    }

    setIsBatchUploading(false);
    fetchPrivateVideos();
    fetchScheduledUpdates();
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
      hour12: true,
      timeZone: "Europe/Madrid",
    });
  };



  // Obtener borradores locales desde la base de datos
  const localDrafts = useMemo(() => {
    return dbVideos
      .filter(v => (v.status === "LOCAL_DRAFT" || v.status === "EDITING") && v.youtubeId)
      .map(v => ({
        id: v.youtubeId,
        dbId: v.id,
        title: v.title,
        description: v.description,
        thumbnail: v.thumbnailBase64 || v.rawFrameBase64 || '',
        publishedAt: v.createdAt,
        tags: v.tags || '',
        privacyStatus: v.privacyStatus || 'private',
        fileName: v.filename || '',
        isLocalDraft: true,
        createdAt: v.createdAt
      }));
  }, [dbVideos]);

  // Filtrar los borradores de YouTube para mostrar solo los que realmente están pendientes
  const pendingPrivateVideos = useMemo(() => {
    const completedOrScheduledIds = new Set([
      ...completedLocalVideos.map(v => v.youtubeId),
      ...scheduledUpdates.map(v => v.youtubeId),
      ...tasks.filter(t => t.status === "COMPLETED" || t.status === "SCHEDULED").map(t => t.youtubeId)
    ].filter(Boolean));

    const mergedList = [...privateVideos];
    localDrafts.forEach(ld => {
      if (!mergedList.some(v => (v.id?.videoId || v.id) === ld.id)) {
        mergedList.push(ld);
      }
    });

    return mergedList
      .filter(video => {
        const ytId = video.id?.videoId || video.id;
        return !completedOrScheduledIds.has(ytId);
      })
      .sort((a, b) => {
        const dateA = new Date(a.publishedAt || a.createdAt || 0);
        const dateB = new Date(b.publishedAt || b.createdAt || 0);
        return dateB - dateA;
      });
  }, [privateVideos, localDrafts, completedLocalVideos, scheduledUpdates, tasks]);

  // Unir historial: tareas completadas del editor + vídeos subidos directamente a YouTube por el subidor
  const mergedCompletedItems = useMemo(() => {
    const taskItems = tasks
      .filter(t => t.status === "COMPLETED")
      .map(t => ({
        id: t.id,
        title: t.title,
        youtubeId: t.youtubeId,
        completedAt: t.completedAt,
        privacyStatus: t.privacyStatus || null,
        taskId: t.id,
        videoId: null
      }));

    // Vídeos subidos a YouTube directamente por el subidor (COMPLETED con youtubeId)
    const videoItems = completedLocalVideos
      .filter(v => v.youtubeId)
      .map(v => ({
        id: v.id,
        title: v.title,
        youtubeId: v.youtubeId,
        completedAt: v.updatedAt,
        privacyStatus: v.privacyStatus || null,
        taskId: null,
        videoId: v.id
      }));

    const mergedByYoutubeId = new Map();
    [...taskItems, ...videoItems].forEach(item => {
      const key = item.youtubeId || item.id;
      const existing = mergedByYoutubeId.get(key);
      if (!existing) {
        mergedByYoutubeId.set(key, item);
        return;
      }

      const itemDate = item.completedAt ? new Date(item.completedAt) : new Date(0);
      const existingDate = existing.completedAt ? new Date(existing.completedAt) : new Date(0);
      mergedByYoutubeId.set(key, {
        ...existing,
        ...item,
        title: item.title || existing.title,
        youtubeId: item.youtubeId || existing.youtubeId,
        completedAt: itemDate >= existingDate ? item.completedAt : existing.completedAt,
        privacyStatus: item.privacyStatus || existing.privacyStatus,
        taskId: existing.taskId || item.taskId,
        videoId: existing.videoId || item.videoId
      });
    });

    return Array.from(mergedByYoutubeId.values()).sort((a, b) => {
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

  if (loadingChannel && isAuthenticated) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#060814",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, sans-serif"
      }}>
        <div style={{
          border: "4px solid rgba(168, 85, 247, 0.1)",
          borderTop: "4px solid #a855f7",
          borderRadius: "50%",
          width: "40px",
          height: "40px",
          animation: "spin 1s linear infinite"
        }} />
        <style dangerouslySetInnerHTML={{
          __html: `
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}} />
        <p style={{ marginTop: "1rem", color: "#94a3b8", fontSize: "0.9rem" }}>Comprobando canal de YouTube...</p>
      </div>
    );
  }

  if (isAuthenticated && !channel.connected) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        {isAuthenticated && <Navbar userEmail={currentUserEmail} userRole={currentUserRole} />}
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "4rem 2rem",
          background: "rgba(15, 23, 42, 0.3)",
          border: "1px solid var(--border-color, rgba(255, 255, 255, 0.08))",
          borderRadius: "24px",
          textAlign: "center",
          backdropFilter: "blur(12px)",
          maxWidth: "600px",
          margin: "8rem auto",
          boxShadow: "0 20px 40px -15px rgba(0,0,0,0.5)",
          fontFamily: "system-ui, -apple-system, sans-serif"
        }}>
          <div style={{
            fontSize: "4rem",
            marginBottom: "1.5rem",
            background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            filter: "drop-shadow(0 0 15px rgba(168, 85, 247, 0.4))",
            display: "inline-block"
          }}>
            🔴
          </div>
          <h2 style={{
            fontSize: "1.8rem",
            fontWeight: "800",
            color: "#f8fafc",
            marginBottom: "1rem"
          }}>
            Canal de YouTube no vinculado
          </h2>
          <p style={{
            color: "#94a3b8",
            fontSize: "0.95rem",
            lineHeight: "1.6",
            marginBottom: "2rem",
            maxWidth: "480px"
          }}>
            Para poder subir y sincronizar tus vídeos con YouTube, es necesario que la plataforma esté conectada a un canal.
          </p>

          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            width: "100%",
            maxWidth: "320px",
            marginTop: "1.5rem"
          }}>
            <button
              onClick={() => {
                if (!config.isConfigured) {
                  alert("Las credenciales del servidor aún no están configuradas por el administrador.");
                  return;
                }
                window.location.href = "/api/auth";
              }}
              style={{
                width: "100%",
                padding: "1rem",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "700",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.75rem",
                cursor: "pointer",
                background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                border: "none",
                color: "#fff",
                boxShadow: "0 4px 15px rgba(168, 85, 247, 0.3)",
                transition: "all 0.3s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 6px 20px rgba(168, 85, 247, 0.5)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 4px 15px rgba(168, 85, 247, 0.3)";
              }}
            >
              🔗 Vincular Canal de YouTube
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className={styles.main}>
      {isAuthenticated && <Navbar userEmail={currentUserEmail} userRole={currentUserRole} />}
      <div className={styles.container}>
        {/* Encabezado */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", flexWrap: "wrap", gap: "1.5rem" }}>
          <div>
            <h1 style={{ fontSize: "1.75rem", fontWeight: "900", background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              📤 Flujo de Subidor
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Sube archivos locales y optimiza metadatos básicos
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            {/* Card del Canal de YouTube */}
            {loadingChannel ? (
              <div className={styles.channelCard} style={{ margin: 0, padding: "0.5rem 1rem", fontSize: "0.85rem" }}>
                Cargando canal...
              </div>
            ) : channel.connected && channel.channel ? (
              <div className={styles.channelCard} style={{ margin: 0, padding: "0.5rem 1rem" }}>
                {channel.channel.thumbnail && (
                  <img src={channel.channel.thumbnail} alt={channel.channel.title} className={styles.channelAvatar} style={{ width: "32px", height: "32px" }} />
                )}
                <div className={styles.channelInfo}>
                  <span className={styles.channelName} style={{ fontSize: "0.85rem" }}>{channel.channel.title}</span>
                  <span className={styles.channelStatus} style={{ fontSize: "0.75rem" }}>Conectado</span>
                </div>
                <a
                  href={`https://studio.youtube.com/channel/${channel.channel.id}/videos`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.connectBtn}
                  style={{
                    width: "auto",
                    padding: "0.35rem 0.7rem",
                    fontSize: "0.75rem",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-color)",
                    textDecoration: "none",
                    color: "var(--text-primary)",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    borderRadius: "8px"
                  }}
                >
                  🎥 Ver Studio
                </a>
                <button
                  onClick={disconnectChannel}
                  className={styles.disconnectBtn}
                  style={{
                    padding: "0.35rem 0.7rem",
                    fontSize: "0.75rem",
                    borderRadius: "8px"
                  }}
                >
                  Desconectar
                </button>
              </div>
            ) : null}


          </div>
        </div>

        {/* Layout de Subida */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: "2rem",
          marginBottom: "2rem",
          alignItems: "stretch"
        }}>
          {/* Cola de Subida por Lotes */}
          <div className={styles.card} style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "flex-start" }}>
            <h3 style={{ fontSize: "1.25rem", fontWeight: "800", marginBottom: "1.25rem", background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              📤 Cola de Subida por Lotes
            </h3>

            {/* Zona de Selección de Archivos Múltiple */}
            <div style={{
              border: "2px dashed rgba(168, 85, 247, 0.4)",
              borderRadius: "14px",
              padding: "1.5rem",
              textAlign: "center",
              cursor: "pointer",
              background: "rgba(168, 85, 247, 0.02)",
              transition: "all 0.2s",
              marginBottom: "1.5rem"
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = "#a855f7"}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = "rgba(168, 85, 247, 0.4)"}
            onClick={() => simpleVideoInputRef.current && simpleVideoInputRef.current.click()}
            >
              <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}>📁</span>
              <span style={{ fontSize: "0.85rem", fontWeight: "700", color: "#f8fafc" }}>Seleccionar vídeos para subir en lote</span>
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "block", marginTop: "0.25rem" }}>Puedes seleccionar varios archivos .mp4, .mov, etc. a la vez</span>
              <input
                type="file"
                ref={simpleVideoInputRef}
                accept="video/*"
                multiple
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
            </div>

            {batchFiles.length === 0 ? (
              <div style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "3rem 1rem",
                color: "var(--text-muted)",
                fontSize: "0.85rem",
                border: "1px dashed var(--border-color)",
                borderRadius: "14px"
              }}>
                No hay vídeos en la cola. Añade archivos arriba para empezar.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  marginBottom: "0.75rem"
                }}>
                  <span>Vídeos en la cola: {batchFiles.length}</span>
                  <span style={{ color: "#a855f7" }}>
                    {batchFiles.filter(f => f.status === 'completed').length} de {batchFiles.length} subidos
                  </span>
                </div>

                <div style={{
                  maxHeight: "500px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                  paddingRight: "0.25rem"
                }}>
                  {batchFiles.map((item, idx) => {
                    const fileSizeMB = (item.file.size / (1024 * 1024)).toFixed(1);
                    return (
                      <div key={item.id} style={{
                        background: "rgba(255, 255, 255, 0.02)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "12px",
                        padding: "1rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.75rem",
                        position: "relative"
                      }}>
                        {/* Cabecera del Item */}
                        <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
                          {/* Miniatura */}
                          <div style={{
                            width: "120px",
                            height: "68px",
                            borderRadius: "8px",
                            overflow: "hidden",
                            background: "#090d1f",
                            border: "1px solid rgba(255,255,255,0.1)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            position: "relative",
                            flexShrink: 0
                          }}>
                            {item.rawFrameBase64 ? (
                              <img src={item.rawFrameBase64} alt="Frame" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : item.status === 'extracting' ? (
                              <div style={{
                                width: "20px",
                                height: "20px",
                                border: "2px solid rgba(168, 85, 247, 0.1)",
                                borderTop: "2px solid #a855f7",
                                borderRadius: "50%",
                                animation: "spin 1s linear infinite"
                              }} />
                            ) : (
                              <span style={{ fontSize: "1.5rem" }}>🎬</span>
                            )}
                          </div>

                          {/* Info y Estado */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: "0.85rem",
                              fontWeight: "700",
                              color: "#f8fafc",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}>
                              {item.file.name}
                            </div>
                            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                              Tamaño: {fileSizeMB} MB
                            </div>

                            {/* Badge del Estado */}
                            <div style={{ marginTop: "0.4rem" }}>
                              {item.status === 'pending' && (
                                <span style={{ fontSize: "0.68rem", fontWeight: "700", color: "#94a3b8", background: "rgba(148, 163, 184, 0.12)", border: "1px solid rgba(148,163,184,0.25)", padding: "2px 8px", borderRadius: "6px" }}>
                                  ⏳ En cola
                                </span>
                              )}
                              {item.status === 'extracting' && (
                                <span style={{ fontSize: "0.68rem", fontWeight: "700", color: "#f59e0b", background: "rgba(245, 158, 11, 0.12)", border: "1px solid rgba(245,158,11,0.25)", padding: "2px 8px", borderRadius: "6px" }}>
                                  🔄 Extrayendo portada...
                                </span>
                              )}
                              {item.status === 'ready' && (
                                <span style={{ fontSize: "0.68rem", fontWeight: "700", color: "#10b981", background: "rgba(16, 185, 129, 0.12)", border: "1px solid rgba(16,185,129,0.25)", padding: "2px 8px", borderRadius: "6px" }}>
                                  ✅ Listo para subir
                                </span>
                              )}
                              {item.status === 'uploading' && (
                                <span style={{ fontSize: "0.68rem", fontWeight: "700", color: "#38bdf8", background: "rgba(56, 189, 248, 0.12)", border: "1px solid rgba(56,189,248,0.25)", padding: "2px 8px", borderRadius: "6px" }}>
                                  📤 Subiendo... {item.progress}%
                                </span>
                              )}
                              {item.status === 'completed' && (
                                <span style={{ fontSize: "0.68rem", fontWeight: "700", color: "#10b981", background: "rgba(16, 185, 129, 0.2)", border: "1px solid #10b981", padding: "2px 8px", borderRadius: "6px" }}>
                                  🎉 ¡Subido con éxito!
                                </span>
                              )}
                              {item.status === 'failed' && (
                                <span style={{ fontSize: "0.68rem", fontWeight: "700", color: "#ef4444", background: "rgba(239, 68, 68, 0.12)", border: "1px solid rgba(239,68,68,0.25)", padding: "2px 8px", borderRadius: "6px" }}>
                                  ❌ Error al subir
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Botón de Eliminar */}
                          {!isBatchUploading && item.status !== 'completed' && (
                            <button
                              type="button"
                              onClick={() => handleRemoveBatchFile(item.id)}
                              style={{
                                background: "rgba(239, 68, 68, 0.12)",
                                border: "1px solid rgba(239, 68, 68, 0.25)",
                                color: "#f87171",
                                borderRadius: "50%",
                                width: "24px",
                                height: "24px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                transition: "all 0.2s"
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(239, 68, 68, 0.2)"}
                              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)"}
                            >✕</button>
                          )}
                        </div>

                        {/* Campos de Edición si el vídeo no está subido */}
                        {item.status !== 'completed' && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.75rem" }}>
                            {/* Input de Título */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-secondary)" }}>Título</span>
                              </div>
                              <input
                                type="text"
                                value={item.title}
                                disabled={isBatchUploading}
                                onChange={(e) => handleUpdateBatchField(item.id, 'title', e.target.value)}
                                style={{
                                  background: "rgba(0,0,0,0.15)",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "8px",
                                  padding: "0.4rem 0.6rem",
                                  fontSize: "0.8rem",
                                  color: "#f8fafc",
                                  width: "100%"
                                }}
                              />
                            </div>

                            {/* Textarea de Descripción */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-secondary)" }}>Descripción</span>
                              </div>
                              <textarea
                                rows="3"
                                value={item.description}
                                disabled={isBatchUploading}
                                onChange={(e) => handleUpdateBatchField(item.id, 'description', e.target.value)}
                                style={{
                                  background: "rgba(0,0,0,0.15)",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "8px",
                                  padding: "0.4rem 0.6rem",
                                  fontSize: "0.8rem",
                                  color: "#f8fafc",
                                  width: "100%",
                                  resize: "vertical",
                                  fontFamily: "inherit"
                                }}
                              />
                            </div>

                            {/* Hora sugerida de publicación para el Editor */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginTop: "0.5rem" }}>
                              <label style={{ fontSize: "0.75rem", fontWeight: "600", color: "#c084fc", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                                📅 Hora sugerida de publicación <span style={{ fontWeight: "400", color: "var(--text-muted)", fontSize: "0.7rem" }}>(informa al Editor — opcional)</span>
                              </label>
                              <DateTimePicker
                                required={false}
                                value={item.scheduledAt || ""}
                                onChange={(e) => handleUpdateBatchField(item.id, 'scheduledAt', e.target.value)}
                                disabled={isBatchUploading}
                              />
                              {item.scheduledAt && (
                                <span style={{ fontSize: "0.68rem", color: "#a78bfa", fontStyle: "italic" }}>
                                  ℹ️ El Editor verá esta hora como referencia para programar la publicación.
                                </span>
                              )}
                            </div>

                            {/* Badge de emparejamiento */}
                            {item.hasMatched && (
                              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", marginTop: "0.25rem" }}>
                                <span style={{
                                  fontSize: "0.68rem",
                                  fontWeight: "700",
                                  color: "#10b981",
                                  background: "rgba(16, 185, 129, 0.08)",
                                  padding: "1px 6px",
                                  borderRadius: "4px"
                                }}>
                                  🤖 Auto-emparejado
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Barra de Progreso de Subida Individual */}
                        {(item.status === 'uploading' || item.status === 'completed') && (
                          <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.75rem", marginTop: "0.25rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                              <span>Progreso de subida a Youtube como borrador:</span>
                              <span style={{ 
                                color: (item.progress >= 100 || item.status === 'completed') ? '#10b981' : 'inherit', 
                                fontWeight: (item.progress >= 100 || item.status === 'completed') ? '700' : 'normal' 
                              }}>
                                {item.progress >= 100 || item.status === 'completed' ? '¡COMPLETADO!' : `${item.progress}%`}
                              </span>
                            </div>
                            <div style={{
                              width: "100%",
                              height: "6px",
                              backgroundColor: "rgba(255, 255, 255, 0.05)",
                              borderRadius: "3px",
                              overflow: "hidden"
                            }}>
                              <div style={{
                                width: `${item.progress}%`,
                                height: "100%",
                                background: "linear-gradient(90deg, #a855f7 0%, #ec4899 100%)",
                                transition: "width 0.3s ease",
                                boxShadow: "0 0 8px rgba(168, 85, 247, 0.4)"
                              }} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Botón de Subida Global */}
                <button
                  type="button"
                  disabled={isBatchUploading || batchFiles.filter(item => item.status === 'ready' || item.status === 'failed').length === 0}
                  onClick={handleStartBatchUpload}
                  className={styles.btnSubmit}
                  style={{
                    marginTop: "1.5rem",
                    background: isBatchUploading ? "#4b5563" : "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                    cursor: (isBatchUploading || batchFiles.filter(item => item.status === 'ready' || item.status === 'failed').length === 0) ? "not-allowed" : "pointer"
                  }}
                >
                  {isBatchUploading ? "⚡ Subiendo cola de vídeos..." : `⚡ Iniciar subida de la cola (${batchFiles.filter(item => item.status === 'ready' || item.status === 'failed').length} vídeos)`}
                </button>

                {/* Aviso de no cerrar la pestaña */}
                {isBatchUploading && (
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
                      La subida del video se pausará o cancelará si sales de esta página.
                    </span>
                  </div>
                )}

                {/* Limpiar completados */}
                {batchFiles.some(item => item.status === 'completed') && !isBatchUploading && (
                  <button
                    type="button"
                    onClick={() => setBatchFiles(prev => prev.filter(item => item.status !== 'completed'))}
                    style={{
                      marginTop: "0.75rem",
                      width: "100%",
                      padding: "0.5rem",
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "10px",
                      color: "#94a3b8",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      fontWeight: "600"
                    }}
                  >
                    🧹 Limpiar vídeos completados de la cola
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Cola 1: Borradores en YouTube esperando que el editor los procese */}
        <div className={styles.card} style={{ marginTop: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
            <div>
              <div style={{ fontSize: "0.68rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em", color: "#f59e0b", marginBottom: "0.25rem" }}>Subidor</div>
              <h3 style={{ fontSize: "1rem", fontWeight: "700", color: "#f8fafc", margin: 0 }}>Borradores · Pendientes de edición</h3>
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.2rem 0 0 0" }}>Vídeos subidos a YouTube como borrador privado. El editor debe completarlos y publicarlos.</p>
            </div>
            <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", padding: "3px 12px", borderRadius: "20px", whiteSpace: "nowrap", flexShrink: 0 }}>
              {pendingPrivateVideos.length} borrador{pendingPrivateVideos.length !== 1 ? "es" : ""}
            </span>
          </div>

          {pendingPrivateVideos.length === 0 ? (
            <div className={styles.emptyState}>
              No hay borradores pendientes. Los vídeos subidos por el subidor aparecerán aquí.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: "320px", overflowY: "auto", paddingRight: "0.25rem" }}>
              {pendingPrivateVideos.map(video => {
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
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <span style={{
                        fontSize: "0.68rem", fontWeight: "700",
                        color: "#f59e0b", background: "rgba(245,158,11,0.12)",
                        border: "1px solid rgba(245,158,11,0.25)",
                        padding: "2px 9px", borderRadius: "6px", whiteSpace: "nowrap", flexShrink: 0
                      }}>
                        Borrador · Pendiente de edición
                      </span>
                      <button
                        type="button"
                        title="Eliminar borrador de YouTube y del sistema"
                        onClick={async () => {
                          if (!confirm(`⚠️ ¿Seguro que quieres eliminar el borrador "${videoTitle}" de YouTube y del sistema? Esta acción no se puede deshacer.`)) return;
                          try {
                            const idToDelete = video.dbId || ytId;
                            const res = await fetch(`/api/videos?id=${idToDelete}`, { method: 'DELETE' });
                            if (res.ok) {
                              fetchScheduledUpdates();
                              fetchPrivateVideos();
                            } else {
                              alert("Error al eliminar el borrador.");
                            }
                          } catch (err) {
                            console.error(err);
                            alert("Error de red al eliminar el borrador.");
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
                <div style={{ fontSize: "0.68rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em", color: "#38bdf8", marginBottom: "0.25rem" }}>Subidor</div>
                <h3 style={{ fontSize: "1rem", fontWeight: "700", color: "#f8fafc", margin: 0 }}>En proceso de subida a borradores</h3>
              </div>
              <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "#38bdf8", background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.25)", padding: "3px 12px", borderRadius: "20px", whiteSpace: "nowrap" }}>
                {scheduledUpdates.length} vídeo{scheduledUpdates.length !== 1 ? "s" : ""}
              </span>
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
                          const isUploading = update.status === "UPLOADING";
                          const msg = isUploading 
                            ? `⚠️ ¿Cancelar y eliminar esta subida activa de "${update.title || "video"}"? Si la subida está en curso en tu navegador, se cancelará.`
                            : `¿Cancelar la publicación de "${update.title || update.youtubeId}"?`;
                          if (!confirm(msg)) return;
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
              <div style={{ fontSize: "0.68rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em", color: "#34d399", marginBottom: "0.25rem" }}>Subidor</div>
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
                      if (!confirm(`¿Eliminar "${item.title || "este vídeo"}" del historial?`)) return;
                      
                      // 1. Actualización optimista: eliminar el elemento del estado local de inmediato
                      const originalTasks = [...tasks];
                      const originalCompletedVideos = [...completedLocalVideos];
                      
                      if (item.taskId) {
                        setTasks(prev => prev.filter(t => t.id !== item.taskId));
                      }
                      if (item.videoId) {
                        setCompletedLocalVideos(prev => prev.filter(v => v.id !== item.videoId));
                      }
                      
                      try {
                        // 2. Ejecutar las peticiones de borrado en paralelo
                        const deletePromises = [];
                        if (item.taskId) {
                          deletePromises.push(fetch(`/api/tasks?id=${item.taskId}`, { method: 'DELETE' }));
                        }
                        if (item.videoId) {
                          deletePromises.push(fetch(`/api/videos?id=${item.videoId}&onlyLocal=true`, { method: 'DELETE' }));
                        }
                        
                        const responses = await Promise.all(deletePromises);
                        const allOk = responses.every(res => res.ok);
                        
                        if (allOk) {
                          // 3. Refrescar silenciosamente en segundo plano sin mostrar estado de carga ("tic")
                          await Promise.all([
                            fetchScheduledUpdates(),
                            fetchTasks(true) // silent = true
                          ]);
                        } else {
                          // Revertir si falla
                          setTasks(originalTasks);
                          setCompletedLocalVideos(originalCompletedVideos);
                          alert("Error al eliminar del historial.");
                        }
                      } catch (err) {
                        console.error(err);
                        // Revertir en caso de excepción
                        setTasks(originalTasks);
                        setCompletedLocalVideos(originalCompletedVideos);
                        alert("Error de red al eliminar del historial.");
                      }
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
        style={{
          position: "absolute",
          top: "-9999px",
          left: "-9999px",
          width: "160px",
          height: "90px",
          opacity: 0,
          pointerEvents: "none"
        }}
        preload="auto"
        muted
        playsInline
        onLoadedMetadata={handleVideoLoadedMetadata}
        onSeeked={handleVideoSeeked}
      />
    </main>
  );
}
               
