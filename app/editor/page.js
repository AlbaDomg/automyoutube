"use client";

import { useState, useEffect, useRef, Fragment, useMemo } from "react";
import styles from "../page.module.css";
import DateTimePicker from "@/components/DateTimePicker";
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

// Helper para extraer ID de video de YouTube limpio
function extractYoutubeId(input) {
  if (!input) return "";
  const trimmed = input.trim();
  try {
    const urlPattern = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|user\/[^\/]+\/|embed\/|watch\?(?:.*&)?v=)|youtu\.be\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/;
    const match = trimmed.match(urlPattern);
    if (match && match[1]) {
      return match[1];
    }
  } catch (e) { }
  const cleanIdPattern = /^([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(cleanIdPattern);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

// Helper para normalizar/slugificar nombres de programas
function slugify(text) {
  if (!text) return "";
  return text.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Helper para encontrar la lista de reproducción ideal basada en el programa, priorizando coincidencias exactas para evitar falsos positivos
function findBestPlaylist(playlists, programName) {
  if (!playlists || playlists.length === 0 || !programName) return null;

  const cleanProg = programName.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
  const slugProg = slugify(cleanProg);
  const normProg = slugProg.replace(/hola/g, "hora");

  // Fase 1: Coincidencia exacta (título limpio o slug normalizado)
  let best = playlists.find(pl => {
    const cleanPl = pl.title.toUpperCase().replace(/_/g, " ").trim();
    if (cleanPl === cleanProg) return true;

    const slugPl = slugify(cleanPl);
    const normPl = slugPl.replace(/hola/g, "hora");
    return normPl === normProg;
  });

  if (best) return best;

  // Fase 2: La playlist contiene al programa (p. ej. playlist larga que contiene el nombre del programa)
  best = playlists.find(pl => {
    const cleanPl = pl.title.toUpperCase().replace(/_/g, " ").trim();
    const slugPl = slugify(cleanPl);
    const normPl = slugPl.replace(/hola/g, "hora");
    return normPl.includes(normProg);
  });

  if (best) return best;

  // Fase 3: El programa contiene a la playlist (exigiendo longitud mínima para evitar falsos positivos como "Hola")
  best = playlists.find(pl => {
    const cleanPl = pl.title.toUpperCase().replace(/_/g, " ").trim();
    const slugPl = slugify(cleanPl);
    const normPl = slugPl.replace(/hola/g, "hora");
    return normPl.length >= 5 && normProg.includes(normPl);
  });

  return best || null;
}

// Helper para encontrar el logotipo ideal basado en la playlist.
// logosCatalog es array de { name, playlistId } o strings (compatibilidad).
// Prioridad 0: coincidencia directa por playlistId. Prioridad 1-3: por nombre.
function findBestLogoForPlaylist(playlistId, playlistTitle, logosCatalog) {
  if (!logosCatalog || logosCatalog.length === 0) return "none";

  // Normalizar catálogo a objetos
  const catalog = logosCatalog.map(l => typeof l === "string" ? { name: l, playlistId: null } : l);

  // Prioridad 0: coincidencia directa por playlistId vinculado en el gestor de logos
  if (playlistId) {
    const directMatch = catalog.find(l => l.playlistId && l.playlistId === playlistId);
    if (directMatch) return directMatch.name;
  }

  // Si no hay título, no podemos hacer coincidencia por nombre
  if (!playlistTitle) return "none";

  const cleanPl = playlistTitle.toUpperCase().replace(/_/g, " ").trim();
  const slugPl = slugify(cleanPl);
  const normPl = slugPl.replace(/hola/g, "hora");

  // Fase 1: Coincidencia exacta por nombre
  let best = catalog.find(l => {
    const cleanLogo = l.name.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
    if (cleanPl === cleanLogo) return true;
    const slugLogo = slugify(cleanLogo);
    const normLogo = slugLogo.replace(/hola/g, "hora");
    return normPl === normLogo;
  });
  if (best) return best.name;

  // Fase 2: El nombre de la playlist contiene el nombre del logo
  best = catalog.find(l => {
    const cleanLogo = l.name.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
    const normLogo = slugify(cleanLogo).replace(/hola/g, "hora");
    return normLogo.length > 2 && normPl.includes(normLogo);
  });
  if (best) return best.name;

  // Fase 3: El nombre del logo contiene el nombre de la playlist
  best = catalog.find(l => {
    const cleanLogo = l.name.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
    const normLogo = slugify(cleanLogo).replace(/hola/g, "hora");
    return normPl.length > 2 && normLogo.includes(normPl);
  });

  return best ? best.name : "none";
}


// Helper para actualizar el sufijo de programa del título y opcionalmente anteponer el emoji
// Helper para actualizar el sufijo de programa del título y opcionalmente anteponer el emoji
function updateTitleSuffix(title, programName, emoji = "") {
  let cleanTitle = (title || "").trim();
  
  // 1. Quitar emoji del principio del título si existe (de forma repetitiva para limpiar cualquier emoji acumulado)
  const emojiPrefixRegex = /^([\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])\s*/u;
  while (emojiPrefixRegex.test(cleanTitle)) {
    cleanTitle = cleanTitle.replace(emojiPrefixRegex, "").trim();
  }

  // 2. Quitar emoji del final del título si existe
  const endingEmojiRegex = /\s*([\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])\s*$/u;
  while (endingEmojiRegex.test(cleanTitle)) {
    cleanTitle = cleanTitle.replace(endingEmojiRegex, "").trim();
  }

  // 3. Quitar el sufijo de programa si existe
  const suffixRegex = /\s*\|.*$/;
  cleanTitle = cleanTitle.replace(suffixRegex, "").trim();

  // 4. Re-construir con el programa al final
  if (programName && programName !== "none") {
    const cleanProg = programName.replace(/\.[^/.]+$/, "").replace(/_/g, " ").toUpperCase().trim();
    cleanTitle = `${cleanTitle} | ${cleanProg}`;
  }
  
  // 5. Anteponer el emoji al principio
  if (emoji) {
    cleanTitle = `${emoji.trim()} ${cleanTitle}`;
  }
  
  return cleanTitle;
}

// Helper para actualizar la URL de programa y asegurar la presencia del bloque social en la descripción
function updateDescriptionUrl(description, programName) {
  const descStr = (description || "").trim();

  // Si no hay programa detectado, devolver la descripción sin modificar
  if (!programName || programName === "none") {
    return descStr;
  }

  const cleanProg = programName.replace(/\.[^/.]+$/, "").replace(/_/g, " ").trim();
  const slug = slugify(cleanProg);
  if (!slug) return descStr;

  // Si ya tiene el bloque de redes sociales o un enlace de tvg.gal, actualizar el link
  if (descStr.includes("seguirnos en todas as nosas redes sociais") || descStr.includes("tvg.gal/")) {
    const urlRegex = /tvg\.gal\/[a-z0-9]+/gi;
    if (urlRegex.test(descStr)) {
      return descStr.replace(urlRegex, `tvg.gal/${slug}`);
    }
    return descStr;
  }

  // Si no tiene el bloque de redes sociales, añadirlo con el slug correspondiente
  const socialBlock = `\n\nPodes ver o programa completo en tvg.gal/${slug}\n\n🔔 Subscríbete á canle oficial da Televisión de Galicia en YouTube: https://www.youtube.com/tvg\n\n🌐 Visita a nosa páxina web: https://agalega.gal/\n\n📲 E tamén podes seguirnos en todas as nosas redes sociais:\nFacebook: https://www.facebook.com/televisiondegalicia\nTwitter: https://x.com/tvgalicia\nInstagram: https://www.instagram.com/tvgalicia\nTikTok: https://www.tiktok.com/@tvgalicia`;

  return descStr ? `${descStr}${socialBlock}` : socialBlock.trim();
}

// Helper para limpiar saltos de línea al pegar texto desde PDFs u otras fuentes de columnas estrechas
const handleCleanPaste = (e, setValFn) => {
  e.preventDefault();
  const pastedText = e.clipboardData.getData("text");
  if (!pastedText) return;

  // 1. Dividir por saltos de línea dobles (que representan saltos de párrafo reales)
  const paragraphs = pastedText.split(/\r?\n\s*\r?\n/);
  
  // 2. Limpiar cada párrafo reemplazando saltos de línea simples por un espacio
  const cleanedParagraphs = paragraphs.map(p => {
    return p
      .replace(/\r?\n/g, " ")      // Reemplazar saltos de línea simples por espacio
      .replace(/\s+/g, " ")        // Evitar múltiples espacios seguidos
      .trim();
  });

  // 3. Volver a unir los párrafos con saltos de línea dobles
  const cleanedText = cleanedParagraphs.join("\n\n");

  const target = e.target;
  const start = target.selectionStart;
  const end = target.selectionEnd;
  const currentValue = target.value;
  const newValue = currentValue.substring(0, start) + cleanedText + currentValue.substring(end);
  
  setValFn(newValue);
  
  // Posicionar el cursor después del texto pegado
  setTimeout(() => {
    target.selectionStart = target.selectionEnd = start + cleanedText.length;
  }, 0);
};

export default function Dashboard() {
  // Estados de autenticación de la aplicación (Google Sign-In)
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState("SEO_MANAGER");
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authError, setAuthError] = useState("");
  
  // Flujos y Roles de Usuario
  const [role, setRole] = useState("publicador"); // 'subidor' | 'publicador'
  const [simpleVideoFile, setSimpleVideoFile] = useState(null);
  const [localExtractedFrame, setLocalExtractedFrame] = useState(null);
  const [simpleTitle, setSimpleTitle] = useState("");
  const [simpleDescription, setSimpleDescription] = useState("");
  const [simpleUploadProgress, setSimpleUploadProgress] = useState(0);
  const [simpleUploadStatus, setSimpleUploadStatus] = useState("");
  const [isSimpleUploading, setIsSimpleUploading] = useState(false);
  const [isOptimizingSimpleTitle, setIsOptimizingSimpleTitle] = useState(false);
  const [isOptimizingSimpleDesc, setIsOptimizingSimpleDesc] = useState(false);
  const [isOptimizingTitle, setIsOptimizingTitle] = useState(false);
  const [isOptimizingDesc, setIsOptimizingDesc] = useState(false);
  const [localVideosQueue, setLocalVideosQueue] = useState([]);
  const [completedLocalVideos, setCompletedLocalVideos] = useState([]);
  const [dbVideos, setDbVideos] = useState([]);

  // Estado del canal
  const [channel, setChannel] = useState({ connected: false, channel: null });
  const [loadingChannel, setLoadingChannel] = useState(true);

  // Estado de las listas de reproducción
  const [playlists, setPlaylists] = useState([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

  // Estado de la configuración
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState({
    GEMINI_API_KEY: "",
    YOUTUBE_CLIENT_ID: "",
    YOUTUBE_CLIENT_SECRET: "",
    isConfigured: false,
  });
  const [configInput, setConfigInput] = useState({
    GEMINI_API_KEY: "",
    YOUTUBE_CLIENT_ID: "",
    YOUTUBE_CLIENT_SECRET: "",
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // Selección de Video, Carga de PDF, Archivos e Interfaz por Lotes
  const [youtubeId, setYoutubeId] = useState("");
  const [suggestedScheduledAt, setSuggestedScheduledAt] = useState(null);
  const [documentFiles, setDocumentFiles] = useState([]);
  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);
  const [logoUploadProgress, setLogoUploadProgress] = useState(null);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [parsedVideos, setParsedVideos] = useState([]);
  const [pendingDocumentName, setPendingDocumentName] = useState("");
  const [isInitialLoadDone, setIsInitialLoadDone] = useState(false);
  const [savedPdfName, setSavedPdfName] = useState("");
  const [privateVideos, setPrivateVideos] = useState([]);
  const [isSyncingBatch, setIsSyncingBatch] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, status: "" });
  const [autoIncrement, setAutoIncrement] = useState(true);
  const [batchScheduleEnabled, setBatchScheduleEnabled] = useState(false);
  const [batchScheduleDate, setBatchScheduleDate] = useState("");

  // Estados para vinculación manual de borradores de YouTube
  const [ytDraftSearchQuery, setYtDraftSearchQuery] = useState("");
  const [showYtDraftSearchDropdown, setShowYtDraftSearchDropdown] = useState(false);
  const [ytDraftSearchResults, setYtDraftSearchResults] = useState([]);
  const [loadingYtDrafts, setLoadingYtDrafts] = useState(false);

  // Estados para buscadores locales por tarjeta en la cola de borradores
  const [cardSearchQueries, setCardSearchQueries] = useState({}); // { [dbId]: query }
  const [cardSearchResults, setCardSearchResults] = useState({}); // { [dbId]: results }
  const [cardSearchLoading, setCardSearchLoading] = useState({}); // { [dbId]: loading }
  const [showSearchForCard, setShowSearchForCard] = useState({}); // { [dbId]: boolean }

  // Estados para búsqueda de videos en lote y filtrado de playlists
  const [batchVideoSearch, setBatchVideoSearch] = useState({}); // { [index]: { query, results, loading } }
  const [playlistFilterSingle, setPlaylistFilterSingle] = useState('');
  const [playlistFilterSingleOpen, setPlaylistFilterSingleOpen] = useState(false);
  const [playlistFilterBatch, setPlaylistFilterBatch] = useState({}); // { [index]: { query, open } }

  // Estado de edición/actualización de YouTube
  const [selectedYoutubeVideo, setSelectedYoutubeVideo] = useState(null);
  const [updateForm, setUpdateForm] = useState({
    title: "",
    description: "",
    tags: "",
    isScheduled: false,
    scheduledAt: "",
    playlistId: ""
  });
  const [updatingYoutubeVideo, setUpdatingYoutubeVideo] = useState(false);

  // Sugerencias de la IA (Títulos/Miniatura)
  const [optimizationSuggestions, setOptimizationSuggestions] = useState(null);
  const [isGeneratingSeoPhrase, setIsGeneratingSeoPhrase] = useState(false);
  const [generatingSeoIndex, setGeneratingSeoIndex] = useState({});

  // Estado de la cola de actualizaciones programadas locales
  const [scheduledUpdates, setScheduledUpdates] = useState([]);
  const [executingScheduler, setExecutingScheduler] = useState(false);
  const [isSimpleScheduled, setIsSimpleScheduled] = useState(false);
  const [simpleScheduledAt, setSimpleScheduledAt] = useState("");

  // Listado de tareas (VideoTask)
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  // Estados del generador de miniaturas (Estilo TVG)
  const [thumbnailText, setThumbnailText] = useState("");
  const [programLogosCatalog, setProgramLogosCatalog] = useState([]);
  const [selectedProgramLogo, setSelectedProgramLogo] = useState("none");
  const [customBgBase64, setCustomBgBase64] = useState(null);
  const [showLogosManager, setShowLogosManager] = useState(false);
  const [logoDropdownOpen, setLogoDropdownOpen] = useState(false);
  const [isAutoThumbnailEnabled, setIsAutoThumbnailEnabled] = useState(false);
  const [newThumbnailBase64, setNewThumbnailBase64] = useState(null);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [isExtractingFrame, setIsExtractingFrame] = useState(false);

  // Estados para regeneración de miniaturas desde el historial
  const [showHistoryThumbnailModal, setShowHistoryThumbnailModal] = useState(false);
  const [historyModalItem, setHistoryModalItem] = useState(null);
  const [historyModalText, setHistoryModalText] = useState("");
  const [historyModalLogo, setHistoryModalLogo] = useState("none");
  const [historyModalCustomBg, setHistoryModalCustomBg] = useState(null);
  const [historyModalOriginalYtBg, setHistoryModalOriginalYtBg] = useState(null);
  const [historyModalGeneratedBase64, setHistoryModalGeneratedBase64] = useState(null);
  const [historyModalCapturedFrames, setHistoryModalCapturedFrames] = useState([]);
  const [historyModalIsExtracting, setHistoryModalIsExtracting] = useState(false);
  const [historyModalStatus, setHistoryModalStatus] = useState("");
  const [historyModalIsSaving, setHistoryModalIsSaving] = useState(false);
  const [historyModalIsGeneratingSeo, setHistoryModalIsGeneratingSeo] = useState(false);
  const historyModalVideoRef = useRef(null);
  const historyModalCanvasRef = useRef(null);
  const historyModalTargetTimes = useRef([]);
  const historyModalCapturingIndex = useRef(-1);
  const historyModalAccumulated = useRef([]);

  const canvasRef = useRef(null);
  const templateImageRef = useRef(null);
  const defaultProgramLogoCanvasRef = useRef(null);
  const maskedTvgLogoCanvasRef = useRef(null);
  const pdfInputRef = useRef(null);
  const simpleVideoInputRef = useRef(null);
  const hiddenVideoRef = useRef(null);
  const autoSchedulerRunningRef = useRef(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [frameTime, setFrameTime] = useState(15);
  const [videoObjectURL, setVideoObjectURL] = useState("");
  const [currentEmoji, setCurrentEmoji] = useState("");
  const [capturedFrames, setCapturedFrames] = useState([]);
  const [isExtractingFrames, setIsExtractingFrames] = useState(false);
  const targetTimes = useRef([]);
  const capturingFrameIndex = useRef(-1);
  const accumulatedFrames = useRef([]);

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
      
      // Calcular 8 timestamps
      const times = [
        duration * 0.08,
        duration * 0.20,
        duration * 0.32,
        duration * 0.44,
        duration * 0.56,
        duration * 0.68,
        duration * 0.80,
        duration * 0.92
      ];
      targetTimes.current = times;
      accumulatedFrames.current = [];
      setCapturedFrames([]);
      setIsExtractingFrames(true);
      capturingFrameIndex.current = 0;
      
      // Iniciar secuencia de seek
      hiddenVideoRef.current.currentTime = times[0];
    }
  };

  const handleVideoSeeked = () => {
    if (hiddenVideoRef.current) {
      // Si estamos en medio del flujo de captura secuencial
      if (capturingFrameIndex.current !== -1) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(hiddenVideoRef.current, 0, 0, canvas.width, canvas.height);
            const base64 = canvas.toDataURL("image/jpeg", 0.85);
            accumulatedFrames.current.push(base64);
            
            const nextIndex = capturingFrameIndex.current + 1;
            if (nextIndex < 8 && nextIndex < targetTimes.current.length) {
              capturingFrameIndex.current = nextIndex;
              hiddenVideoRef.current.currentTime = targetTimes.current[nextIndex];
            } else {
              // Finalizada la captura de los 8 fotogramas
              capturingFrameIndex.current = -1;
              setIsExtractingFrames(false);
              const frames = [...accumulatedFrames.current];
              setCapturedFrames(frames);
              
              // Seleccionar el primero por defecto
              if (frames.length > 0) {
                setLocalExtractedFrame(frames[0]);
                setCustomBgBase64(frames[0]);
                setSimpleUploadStatus("Fotogramas del vídeo capturados correctamente.");
              }
            }
          }
        } catch (err) {
          console.error("Error al extraer fotogramas en seeked secuencial:", err);
          capturingFrameIndex.current = -1;
          setIsExtractingFrames(false);
          setSimpleUploadStatus("Fallo al extraer fotogramas del vídeo.");
        }
      } else {
        // Fallback de seek manual libre
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(hiddenVideoRef.current, 0, 0, canvas.width, canvas.height);
            const base64 = canvas.toDataURL("image/jpeg", 0.85);
            setLocalExtractedFrame(base64);
            setCustomBgBase64(base64);
          }
        } catch (err) {
          console.error("Error al extraer fotograma en seeked libre:", err);
        }
      }
    }
  };

  const handleSelectFrame = (base64, idx) => {
    setLocalExtractedFrame(base64);
    setCustomBgBase64(base64);
    if (targetTimes.current && targetTimes.current[idx] !== undefined) {
      setFrameTime(targetTimes.current[idx]);
    }
  };

  const handleSliderChange = (e) => {
    const newTime = parseFloat(e.target.value);
    setFrameTime(newTime);
    if (hiddenVideoRef.current && hiddenVideoRef.current.src) {
      hiddenVideoRef.current.currentTime = newTime;
    }
  };

  const handleOpenHistoryThumbnailModal = async (item) => {
    setHistoryModalItem(item);
    setHistoryModalLogo("none");
    setHistoryModalCustomBg(null);
    setHistoryModalOriginalYtBg(null);
    setHistoryModalGeneratedBase64(null);
    setHistoryModalCapturedFrames([]);
    setHistoryModalIsExtracting(false);
    setHistoryModalStatus("Inicializando...");
    setHistoryModalIsSaving(false);
    setShowHistoryThumbnailModal(true);

    // Buscar si existe una tarea de sincronización para este video y cargar la frase SEO original
    const task = tasks.find(t => t.youtubeId === item.youtubeId);
    if (task && task.thumbnailText) {
      setHistoryModalText(task.thumbnailText);
    } else {
      // Iniciar con un texto temporal e invocar la generación automática por IA en segundo plano
      setHistoryModalText("Generando frase SEO con IA...");
      setHistoryModalIsGeneratingSeo(true);
      try {
        const res = await fetch("/api/youtube/generate-seo-phrase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: item.title, description: item.description || "" })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.thumbnailText) {
            // Eliminar emojis del texto SEO generado
            const cleanPhrase = data.thumbnailText.replace(/[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/gu, "");
            setHistoryModalText(cleanPhrase);
          } else {
            setHistoryModalText(ensureThreeToFiveWords(item.title ? item.title.split(" | ")[0] : "", item.title || ""));
          }
        } else {
          setHistoryModalText(ensureThreeToFiveWords(item.title ? item.title.split(" | ")[0] : "", item.title || ""));
        }
      } catch (err) {
        console.error("[Auto SEO History] Error al generar frase SEO:", err);
        setHistoryModalText(ensureThreeToFiveWords(item.title ? item.title.split(" | ")[0] : "", item.title || ""));
      } finally {
        setHistoryModalIsGeneratingSeo(false);
      }
    }

    const dbVideo = completedLocalVideos.find(v => v.youtubeId === item.youtubeId) || dbVideos.find(v => v.youtubeId === item.youtubeId);
    
    let detectedLogo = "none";
    if (item.title) {
      const parts = item.title.split(" | ");
      if (parts.length > 1) {
        const programName = parts[1];
        const bestLogo = findBestLogoForPlaylist(null, programName, programLogosCatalog);
        if (bestLogo) {
          detectedLogo = bestLogo;
        }
      }
    }
    setHistoryModalLogo(detectedLogo);

    if (item.youtubeId) {
      setHistoryModalStatus("Cargando miniatura actual...");
      try {
        // Si el video está en nuestra base de datos local, usamos la ruta de miniatura local
        // ya que funciona siempre independientemente de que sea privado o público en YouTube
        const targetUrl = dbVideo
          ? `/api/videos/thumbnail?id=${dbVideo.id}`
          : `/api/youtube/thumbnail-proxy?url=${encodeURIComponent(`https://i.ytimg.com/vi/${item.youtubeId}/hqdefault.jpg`)}`;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.crossOrigin = "anonymous";
        img.src = targetUrl;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
        
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, 1280, 720);
          const base64 = canvas.toDataURL("image/jpeg", 0.85);
          setHistoryModalCustomBg(base64);
          setHistoryModalOriginalYtBg(base64);
        }
      } catch (err) {
        console.warn("Fallo al precargar la miniatura:", err);
      }
    }

    if (dbVideo && dbVideo.hasExtractedFrames) {
      const count = dbVideo.extractedFramesCount || 10;
      const serverFrames = [];
      for (let i = 0; i < count; i++) {
        serverFrames.push(`/api/videos/thumbnail?id=${dbVideo.id}&frame=${i}`);
      }
      setHistoryModalCapturedFrames(serverFrames);
      setHistoryModalIsExtracting(false);
      setHistoryModalStatus("Listo.");
    } else if (dbVideo && dbVideo.filePath && !['PDF_PARSED', 'YOUTUBE_UPLOAD', 'YOUTUBE_UPDATE'].includes(dbVideo.filePath)) {
      setHistoryModalStatus("Cargando vídeo local para extraer fotogramas...");
      setHistoryModalIsExtracting(true);
      
      const srcUrl = dbVideo.filePath.startsWith('https://') 
        ? dbVideo.filePath 
        : `/api/videos/stream?id=${dbVideo.id}`;
      
      setTimeout(() => {
        if (historyModalVideoRef.current) {
          historyModalVideoRef.current.src = srcUrl;
          historyModalVideoRef.current.load();
        }
      }, 300);
    } else {
      setHistoryModalStatus("Listo.");
    }
  };

  const handleHistoryVideoLoadedMetadata = () => {
    if (historyModalVideoRef.current) {
      const duration = historyModalVideoRef.current.duration;
      const times = [
        duration * 0.05,
        duration * 0.15,
        duration * 0.25,
        duration * 0.35,
        duration * 0.45,
        duration * 0.55,
        duration * 0.65,
        duration * 0.75,
        duration * 0.85,
        duration * 0.95
      ];
      historyModalTargetTimes.current = times;
      historyModalAccumulated.current = [];
      historyModalCapturingIndex.current = 0;
      historyModalVideoRef.current.currentTime = times[0];
    }
  };

  const handleHistoryVideoSeeked = () => {
    if (historyModalVideoRef.current && historyModalCapturingIndex.current !== -1) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(historyModalVideoRef.current, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL("image/jpeg", 0.85);
          historyModalAccumulated.current.push(base64);
          
          const nextIndex = historyModalCapturingIndex.current + 1;
          if (nextIndex < 10 && nextIndex < historyModalTargetTimes.current.length) {
            historyModalCapturingIndex.current = nextIndex;
            historyModalVideoRef.current.currentTime = historyModalTargetTimes.current[nextIndex];
          } else {
            historyModalCapturingIndex.current = -1;
            setHistoryModalIsExtracting(false);
            setHistoryModalCapturedFrames([...historyModalAccumulated.current]);
            setHistoryModalStatus("Listo.");
          }
        }
      } catch (err) {
        console.error("Error al extraer fotograma del historial en seeked:", err);
        historyModalCapturingIndex.current = -1;
        setHistoryModalIsExtracting(false);
        setHistoryModalStatus("Fallo al extraer fotogramas del vídeo local.");
      }
    }
  };

  const handleGenerateHistoryModalPreview = async () => {
    if (!historyModalItem) return;
    
    // Si el fondo es la miniatura original de YouTube, no dibujamos ningún overlay de texto o logos encima.
    if (historyModalCustomBg && historyModalOriginalYtBg && historyModalCustomBg === historyModalOriginalYtBg) {
      setHistoryModalGeneratedBase64(historyModalOriginalYtBg);
      return;
    }

    // Si está cargando/generando la frase SEO por IA, no queremos pintar el texto temporal
    const textToDraw = historyModalIsGeneratingSeo ? "" : historyModalText;

    const base64 = await generateSingleAutoThumbnail(
      textToDraw,
      historyModalItem,
      historyModalCustomBg,
      historyModalLogo
    );
    if (base64) {
      setHistoryModalGeneratedBase64(base64);
    }
  };

  const handleSaveHistoryThumbnail = async () => {
    if (!historyModalGeneratedBase64 || !historyModalItem) return;
    setHistoryModalIsSaving(true);
    setHistoryModalStatus("Subiendo nueva miniatura a YouTube...");

    try {
      const ytRes = await fetch("/api/youtube/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeVideoId: historyModalItem.youtubeId,
          thumbnail: historyModalGeneratedBase64
        })
      });

      if (!ytRes.ok) {
        const data = await ytRes.json();
        throw new Error(data.error || "Fallo al subir la miniatura a YouTube");
      }

      const ytData = await ytRes.json();
      if (ytData.thumbnailError) {
        throw new Error(ytData.thumbnailError);
      }

      const dbVideo = completedLocalVideos.find(v => v.youtubeId === historyModalItem.youtubeId) || dbVideos.find(v => v.youtubeId === historyModalItem.youtubeId);
      if (dbVideo) {
        setHistoryModalStatus("Guardando en la base de datos local...");
        const patchRes = await fetch(`/api/videos?id=${dbVideo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thumbnailBase64: historyModalGeneratedBase64,
            rawFrameBase64: (historyModalCustomBg && historyModalCustomBg.startsWith("data:")) ? historyModalCustomBg : undefined
          })
        });

        if (patchRes.ok) {
          setCompletedLocalVideos(prev => prev.map(v => 
            v.id === dbVideo.id 
              ? { 
                  ...v, 
                  thumbnailBase64: historyModalGeneratedBase64, 
                  rawFrameBase64: (v.rawFrameBase64 && v.rawFrameBase64.startsWith('[')) 
                    ? v.rawFrameBase64 
                    : historyModalCustomBg 
                } 
              : v
          ));
        }
      }

      alert("¡Miniatura actualizada con éxito en YouTube!");
      setShowHistoryThumbnailModal(false);
    } catch (err) {
      alert("Error al actualizar la miniatura: " + err.message);
    } finally {
      setHistoryModalIsSaving(false);
      setHistoryModalStatus("Listo.");
    }
  };

  const handleHistoryModalNewBgSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      setHistoryModalCustomBg(event.target.result);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (showHistoryThumbnailModal && historyModalItem) {
      handleGenerateHistoryModalPreview();
    }
  }, [showHistoryThumbnailModal, historyModalText, historyModalLogo, historyModalCustomBg, historyModalIsGeneratingSeo]);

  const fetchEmojiForTitle = async (title, description) => {
    try {
      const res = await fetch("/api/youtube/generate-emoji", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description })
      });
      if (res.ok) {
        const data = await res.json();
        return data.emoji || "";
      }
    } catch (err) {
      console.warn("Failed to generate emoji:", err);
    }
    return "";
  };

  // Helper para contar palabras limpias de la frase SEO
  const getWordCount = (text) => {
    if (!text) return 0;
    const clean = text.replace(/[\/\-\"\']/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) return 0;
    return clean.split(/\s+/).length;
  };

  // Helper para garantizar entre 3 y 5 palabras en el texto de la miniatura
  const ensureThreeToFiveWords = (text, fallbackContext = "") => {
    if (!text) text = "";
    // Eliminar cualquier emoji del texto para cumplir las especificaciones del usuario
    let cleanText = text.replace(/[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/gu, "");
    cleanText = cleanText.replace(/[\/\-\"\']/g, " ").replace(/\s+/g, " ").trim();
    let words = cleanText ? cleanText.split(/\s+/) : [];
    words = words.filter(w => w.trim().length > 0);

    if (words.length >= 3 && words.length <= 5) {
      return words.join(" ");
    }
    if (words.length > 5) {
      return words.slice(0, 5).join(" ");
    }

    const contextWords = fallbackContext
      ? fallbackContext.replace(/[^a-zA-Z0-9À-ÿ\s]/g, " ").replace(/\s+/g, " ").trim().split(/\s+/)
      : [];

    const significantContextWords = contextWords.filter(w => w.length >= 3 && !words.map(x => x.toLowerCase()).includes(w.toLowerCase()));
    const defaultPool = ["ALERTA", "AVISO", "INFO", "GALEGO", "HOXE", "NOVA", "TVG"];

    for (const word of significantContextWords) {
      if (words.length >= 3) break;
      words.push(word);
    }
    for (const word of defaultPool) {
      if (words.length >= 3) break;
      if (!words.map(x => x.toLowerCase()).includes(word.toLowerCase())) {
        words.push(word);
      }
    }
    while (words.length < 3) {
      words.push("HOXE");
    }
    return words.slice(0, 3).join(" ");
  };

  // Helper para cargar imágenes de forma asíncrona en canvas
  const loadImage = (src) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = src;
    });
  };

  // Extrae un fotograma del vídeo de forma asíncrona mediante un canvas
  // seekTime: segundo concreto a capturar (opcional; por defecto usa 15s o mitad del vídeo)
  const extractVideoFrame = (videoSrc, seekTime = null) => {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.src = videoSrc;
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;

      video.style.position = "absolute";
      video.style.top = "-9999px";
      video.style.left = "-9999px";
      video.style.width = "640px";
      video.style.height = "360px";
      document.body.appendChild(video);

      let timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout al extraer fotograma del vídeo"));
      }, 15000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        if (video.parentNode) {
          document.body.removeChild(video);
        }
      };

      video.addEventListener("loadedmetadata", () => {
        const targetTime = seekTime !== null ? Math.min(seekTime, video.duration - 0.1) : (video.duration > 30 ? 15 : video.duration / 2);
        video.currentTime = Math.max(0, targetTime);
      });

      video.addEventListener("seeked", () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
            cleanup();
            resolve(dataUrl);
          } else {
            cleanup();
            reject(new Error("No se pudo obtener el contexto del canvas"));
          }
        } catch (err) {
          cleanup();
          reject(err);
        }
      });

      video.addEventListener("error", () => {
        cleanup();
        reject(video.error || new Error("Error cargando el vídeo para la captura"));
      });

      video.load();
    });
  };

  // Restablecer estados del generador de miniatura
  const handleResetThumbnailStates = () => {
    setThumbnailText("");
    setSelectedProgramLogo("none");
    setCustomBgBase64(null);
    setIsAutoThumbnailEnabled(false);
    setNewThumbnailBase64(null);
    setVideoDuration(0);
    setFrameTime(15);
  };

  const handleCloseEditor = async () => {
    if (selectedYoutubeVideo && selectedYoutubeVideo.isLocal) {
      try {
        await fetch(`/api/videos?id=${selectedYoutubeVideo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "LOCAL_DRAFT" })
        });
        fetchScheduledUpdates();
      } catch (err) {
        console.error("Error resetting video status to LOCAL_DRAFT:", err);
      }
    }
    setSelectedYoutubeVideo(null);
    setYoutubeId("");
    setSuggestedScheduledAt(null);
    handleResetThumbnailStates();
  };

  // Helper para obtener el logotipo asociado a una playlist
  const getMatchedLogoForPlaylist = (playlistId) => {
    if (!playlistId || playlistId === "") return "none";
    const playlist = playlists.find(pl => pl.id === playlistId);
    if (!playlist) return "none";
    // Pasa playlistId para coincidencia directa (prioridad 0) y title para fallback por nombre
    return findBestLogoForPlaylist(playlistId, playlist.title, programLogosCatalog);
  };

  // Helper para auto-detectar programa y lista de reproducción basada en título, descripción y nombre del archivo original
  const detectProgramAndPlaylist = (title, description, fileName, currentLogo = "none") => {
    const rawTitle = (title || "").trim();
    const rawDesc = (description || "").trim();
    const rawFile = (fileName || "").trim();

    let logoName = "none";
    let playlistId = "";

    // Si nos pasan un programa detectado por Gemini (currentLogo), intentamos resolverlo
    // contra el catálogo de logos registrados para obtener su nombre de archivo real y playlist vinculada.
    if (currentLogo && currentLogo !== "none") {
      const matchedLogo = programLogosCatalog.find(logo => {
        const lName = typeof logo === "string" ? logo : logo.name;
        const cleanName = lName.replace(/\.[^/.]+$/, "").replace(/_/g, " ").trim().toUpperCase();
        const cleanCurrent = currentLogo.replace(/\.[^/.]+$/, "").replace(/_/g, " ").trim().toUpperCase();
        return cleanName === cleanCurrent || slugify(cleanName) === slugify(cleanCurrent);
      });

      if (matchedLogo) {
        logoName = typeof matchedLogo === "string" ? matchedLogo : matchedLogo.name;
        playlistId = typeof matchedLogo !== "string" ? (matchedLogo.playlistId || "") : "";
        return { playlistId, logoName };
      }
      return { playlistId: "", logoName: currentLogo };
    }

    // 1. PRIORIDAD: Buscar coincidencia en el catálogo de logotipos (los 22 del gestor de logos)
    if (programLogosCatalog && programLogosCatalog.length > 0) {
      let bestMatch = null;
      let highestScore = 0;

      for (const logo of programLogosCatalog) {
        const lName = typeof logo === "string" ? logo : logo.name;
        const cleanLogo = lName.replace(/\.[^/.]+$/, "").replace(/_/g, " ").trim();
        const slugLogo = slugify(cleanLogo);
        if (!slugLogo) continue;

        // Calcular siglas (ej. "Hora Galega" -> "hg")
        const initials = cleanLogo
          .split(/\s+/)
          .filter(w => {
            const lw = w.toLowerCase();
            return !["de", "o", "a", "e", "os", "as", "do", "da", "dos", "das", "co", "coa", "cos", "coas"].includes(lw);
          })
          .map(w => w[0])
          .join("")
          .toLowerCase();

        // Slugs separados: archivo tiene más peso que título/descripción
        const slugFile = slugify(rawFile);
        const slugTitleDesc = slugify(`${rawTitle} ${rawDesc}`);

        // Expresión regular para siglas, más flexible (permite números pegados como HG1234)
        const regexLogoSiglas = initials.length >= 2
          ? new RegExp(
              `(^|[^a-z])${initials}([^a-z]|$)`,
              "i"
            )
          : null;
        const isLogoSiglasInFile = regexLogoSiglas ? regexLogoSiglas.test(rawFile.replace(/\.[^/.]+$/, "")) : false;
        const isLogoSiglasInTitle = regexLogoSiglas ? regexLogoSiglas.test(rawTitle) : false;

        // Palabras clave significativas (longitud >= 3) — split primero, slug después
        const wordBlacklist = new Set(["logo", "programa", "galicia", "galega", "png", "jpg", "con", "por", "para"]);
        const words = cleanLogo
          .split(/\s+/)
          .map(w => slugify(w))
          .filter(w => w.length >= 3 && !wordBlacklist.has(w));

        let score = 0;

        // Puntuación:
        // 1. Coincidencia exacta del slug completo en el ARCHIVO -> máxima prioridad
        if (slugFile.includes(slugLogo)) {
          score = 200 + slugLogo.length;
        }
        // 2. Coincidencia exacta del slug completo en título/descripción
        else if (slugTitleDesc.includes(slugLogo)) {
          score = 100 + slugLogo.length;
        }
        // 3. Siglas en el nombre de archivo -> alta prioridad
        else if (isLogoSiglasInFile) {
          score = 80 + initials.length;
        }
        // 4. Siglas en el título
        else if (isLogoSiglasInTitle) {
          score = 50 + initials.length;
        }
        // 5. Palabras clave
        else {
          const wordsInFile = words.filter(word => slugFile.includes(word)).length;
          const wordsInText = words.filter(word => slugTitleDesc.includes(word)).length;
          if (wordsInFile > 0) {
            score = 30 + wordsInFile * 5; // archivo puntúa más
          } else if (wordsInText > 0) {
            score = 10 + wordsInText;
          }
        }

        if (score > highestScore) {
          highestScore = score;
          bestMatch = logo;
        }
      }

      if (bestMatch) {
        logoName = typeof bestMatch === "string" ? bestMatch : bestMatch.name;
        const linkedPlaylistId = typeof bestMatch !== "string" ? bestMatch.playlistId : null;

        if (linkedPlaylistId) {
          playlistId = linkedPlaylistId;
        } else {
          const cleanLogo = logoName.replace(/\.[^/.]+$/, "").replace(/_/g, " ").trim();
          const foundPl = findBestPlaylist(playlists, cleanLogo) || findBestPlaylist(playlists, rawTitle || rawFile);
          if (foundPl) {
            playlistId = foundPl.id;
            const playlistLinkedLogo = programLogosCatalog.find(
              l => typeof l === "object" && l.playlistId === foundPl.id
            );
            if (playlistLinkedLogo) {
              logoName = playlistLinkedLogo.name;
            }
          }
        }
        return { playlistId, logoName };
      }
    }

    return { playlistId, logoName };
  };

  // Cambiar playlist y actualizar automáticamente logotipo, título y descripción en el editor individual
  const handleSinglePlaylistChange = (playlistId) => {
    const matchedLogo = getMatchedLogoForPlaylist(playlistId);
    setSelectedProgramLogo(matchedLogo);
    if (matchedLogo && matchedLogo !== "none") {
      setIsAutoThumbnailEnabled(true);
    }
    setUpdateForm(prev => ({
      ...prev,
      playlistId: playlistId,
      title: updateTitleSuffix(prev.title, matchedLogo, currentEmoji),
      description: updateDescriptionUrl(prev.description, matchedLogo)
    }));
  };

  // Cambiar playlist y actualizar automáticamente logotipo, título y descripción en el editor por lotes
  const handleBatchPlaylistChange = (index, playlistId) => {
    const matchedLogo = getMatchedLogoForPlaylist(playlistId);
    setParsedVideos(prev => {
      const list = [...prev];
      const idx = list.findIndex(v => v.index === index);
      if (idx !== -1) {
        list[idx].playlistId = playlistId;
        list[idx].selectedProgramLogo = matchedLogo;
        list[idx].title = updateTitleSuffix(list[idx].title, matchedLogo);
        list[idx].description = updateDescriptionUrl(list[idx].description, matchedLogo);
      }
      return list;
    });
    regenerateThumbnailForIndex(index, { selectedProgramLogo: matchedLogo });
  };

  // Cambiar logo en el editor individual
  const handleLogoChange = (logoVal) => {
    setSelectedProgramLogo(logoVal);
    setUpdateForm(prev => ({
      ...prev,
      title: updateTitleSuffix(prev.title, logoVal, currentEmoji),
      description: updateDescriptionUrl(prev.description, logoVal)
    }));
  };

  // Cambiar logo en el editor por lotes (solo cambia el logo y regenera miniatura, no toca título/descripción/playlist)
  const handleBatchLogoChange = (index, logoVal) => {
    setParsedVideos(prev => {
      const list = [...prev];
      const idx = list.findIndex(v => v.index === index);
      if (idx !== -1) {
        list[idx].selectedProgramLogo = logoVal;
      }
      return list;
    });
    regenerateThumbnailForIndex(index, { selectedProgramLogo: logoVal });
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
          // Limpiar url
          window.history.replaceState({}, document.title, window.location.pathname);
        } else if (urlParams.has("login")) {
          // Limpiar url
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
              const userRole = data.user.role || "SEO_MANAGER";
              setCurrentUserRole(userRole);

              // Restringir el acceso si no es ADMIN o SEO_MANAGER
              if (userRole !== "ADMIN" && userRole !== "SEO_MANAGER") {
                setAuthError("No tienes permiso para acceder al flujo de Editor.");
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

  // Restaurar videos pendientes desde localStorage al cargar/autenticarse
  useEffect(() => {
    const restorePendingVideos = async () => {
      if (typeof window === 'undefined') return;
      const savedVideos = localStorage.getItem("pending_videos_to_edit");
      const savedDocName = localStorage.getItem("pending_videos_document_name");
      if (savedVideos) {
        try {
          const parsed = JSON.parse(savedVideos);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setParsedVideos(parsed);
            if (savedDocName) {
              setPendingDocumentName(savedDocName);
            }

            // 1. Obtener videos privados para que el mapeo/visualización funcione
            const activePrivateVideos = await fetchPrivateVideos();

            // 2. Regenerar miniaturas automáticas que falten tras un pequeño retardo
            setTimeout(() => {
              parsed.forEach(video => {
                if (video.isAutoThumbnailEnabled && !video.generatedThumbnailBase64) {
                  regenerateThumbnailForIndex(video.index, {}, activePrivateVideos);
                }
              });
            }, 1200);
          }
        } catch (e) {
          console.error("Error al restaurar los vídeos pendientes:", e);
        }
      }
      setIsInitialLoadDone(true);
    };

    if (isAuthenticated) {
      restorePendingVideos();
    }
  }, [isAuthenticated]);

  // Guardar estado de videos pendientes en localStorage al modificarse
  useEffect(() => {
    if (!isInitialLoadDone) return;
    if (typeof window === 'undefined') return;

    if (parsedVideos.length > 0) {
      try {
        localStorage.setItem("pending_videos_to_edit", JSON.stringify(parsedVideos));
        if (documentFiles && documentFiles.length > 0) {
          const namesCombined = documentFiles.map(f => f.name).join(", ");
          localStorage.setItem("pending_videos_document_name", namesCombined);
          setPendingDocumentName(namesCombined);
        }
      } catch (error) {
        console.warn("Límite de localStorage excedido, guardando vídeos sin imágenes base64...", error);
        // Quitar base64 pesado para evitar QuotaExceededError
        const optimizedList = parsedVideos.map(v => ({
          ...v,
          generatedThumbnailBase64: null,
          customBgBase64: null
        }));
        try {
          localStorage.setItem("pending_videos_to_edit", JSON.stringify(optimizedList));
          if (documentFiles && documentFiles.length > 0) {
            const namesCombined = documentFiles.map(f => f.name).join(", ");
            localStorage.setItem("pending_videos_document_name", namesCombined);
            setPendingDocumentName(namesCombined);
          }
        } catch (fallbackErr) {
          console.error("Fallo crítico al guardar estado de vídeos optimizado:", fallbackErr);
        }
      }
    } else {
      localStorage.removeItem("pending_videos_to_edit");
      localStorage.removeItem("pending_videos_document_name");
      setPendingDocumentName("");
    }
  }, [parsedVideos, documentFiles, isInitialLoadDone]);

  // Precargar y enmascarar logotipo de la cadena (TVG) y plantilla de programa (Hora Galega)
  useEffect(() => {
    // 1. Cargar plantilla de programa ("Hora Galega")
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = "/template_thumbnail.png";
    img.onload = () => {
      templateImageRef.current = img;
      console.log("[Thumbnail Generator] Plantilla cargada.");

      try {
        const progCanvas = document.createElement("canvas");
        progCanvas.width = 400;
        progCanvas.height = 172;
        const progCtx = progCanvas.getContext("2d");
        progCtx.drawImage(img, 0, 0, 400, 172, 0, 0, 400, 172);

        const progImgData = progCtx.getImageData(0, 0, 400, 172);
        const progData = progImgData.data;
        for (let i = 0; i < progData.length; i += 4) {
          const r = progData[i];
          const g = progData[i + 1];
          const b = progData[i + 2];
          // Volver transparente el fondo blanco/grisáceo del logotipo
          if (r > 220 && g > 220 && b > 220) {
            progData[i + 3] = 0;
          }
        }
        progCtx.putImageData(progImgData, 0, 0);
        defaultProgramLogoCanvasRef.current = progCanvas;
        console.log("[Thumbnail Generator] Logotipo por defecto procesado.");
        if (isAuthenticated) {
          fetchProgramLogosCatalog();
        }
      } catch (err) {
        console.error("[Thumbnail Generator] Error procesando plantilla:", err);
      }
    };

    // 2. Cargar y enmascarar tvg_logo.png
    const tvgImg = new Image();
    tvgImg.crossOrigin = "anonymous";
    tvgImg.src = "/tvg_logo.png";
    tvgImg.onload = () => {
      try {
        const lw = tvgImg.width;
        const lh = tvgImg.height;

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = lw;
        tempCanvas.height = lh;
        const tempCtx = tempCanvas.getContext("2d");
        if (tempCtx) {
          tempCtx.drawImage(tvgImg, 0, 0);
          const imgData = tempCtx.getImageData(0, 0, lw, lh);
          const data = imgData.data;

          // Extraer la forma exacta del logotipo G mediante BFS (flood fill)
          // Empezamos en un pixel que está garantizado dentro de la 'G' blanca (x=520, y=330)
          const visited = new Uint8Array(lw * lh);
          const queue = [520, 330];
          visited[330 * lw + 520] = 1;

          const isWhitePixel = (r, g, b) => r >= 250 && g >= 250 && b >= 250;
          let head = 0;

          while (head < queue.length) {
            const cx = queue[head++];
            const cy = queue[head++];

            const neighbors = [
              { x: cx + 1, y: cy },
              { x: cx - 1, y: cy },
              { x: cx, y: cy + 1 },
              { x: cx, y: cy - 1 }
            ];

            for (let i = 0; i < neighbors.length; i++) {
              const n = neighbors[i];
              // Restringimos x >= 420 para evitar fugas hacia la cuadrícula de fondo izquierda
              if (n.x >= 420 && n.x < lw && n.y >= 0 && n.y < lh) {
                const nIdx = n.y * lw + n.x;
                if (!visited[nIdx]) {
                  const r = data[nIdx * 4];
                  const g = data[nIdx * 4 + 1];
                  const b = data[nIdx * 4 + 2];
                  if (isWhitePixel(r, g, b)) {
                    visited[nIdx] = 1;
                    queue.push(n.x, n.y);
                  }
                }
              }
            }
          }

          // Aplicar la máscara
          for (let y = 0; y < lh; y++) {
            for (let x = 0; x < lw; x++) {
              const idx = (y * lw + x) * 4;

              let keep = false;
              if (x >= (y + 115)) {
                keep = true;
              } else {
                const pixelIdx = y * lw + x;
                if (visited[pixelIdx]) {
                  keep = true;
                }
              }

              if (!keep) {
                data[idx + 3] = 0; // Hacer transparente
              }
            }
          }
          tempCtx.putImageData(imgData, 0, 0);
          maskedTvgLogoCanvasRef.current = tempCanvas;
          console.log("[Thumbnail Generator] Logotipo de la cadena (TVG) enmascarado y listo.");
        }
      } catch (err) {
        console.error("[Thumbnail Generator] Error enmascarando tvg_logo.png:", err);
      }
    };
  }, [isAuthenticated]);

  const uploadLogoWithProgress = (file, onSuccess, onError) => {
    setLogoUploadProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/program-logos", true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        setLogoUploadProgress(percentComplete);
      }
    };

    xhr.onload = () => {
      setLogoUploadProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.success) {
            onSuccess(data);
          } else {
            onError(new Error(data.error || "Error desconocido"));
          }
        } catch (e) {
          onError(e);
        }
      } else {
        onError(new Error(`Error del servidor (${xhr.status})`));
      }
    };

    xhr.onerror = () => {
      setLogoUploadProgress(null);
      onError(new Error("Error de red o conexión"));
    };

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  };

  const fetchProgramLogosCatalog = async () => {
    try {
      const res = await fetch("/api/program-logos", { cache: "no-store" });
      const data = await res.json();
      if (data.logos) {
        // Guardar objetos completos { name, playlistId }
        setProgramLogosCatalog(data.logos);
      }
    } catch (err) {
      console.error("Error fetching program logos catalog:", err);
    }
  };

  // Cargar catálogo de logotipos al cargar la página
  useEffect(() => {
    if (isAuthenticated) {
      fetchProgramLogosCatalog();
    }
  }, [isAuthenticated]);

  // Cargar preferencia de logotipo al seleccionar un vídeo de forma dinámica y en tiempo real.
  // Se ejecuta cuando cambia el vídeo seleccionado, el catálogo de logos o las playlists (por si cargan tarde).
  useEffect(() => {
    if (!selectedYoutubeVideo) return;

    // Solo auto-detectar si todavía no se ha asignado logo ni playlist manualmente
    const detected = detectProgramAndPlaylist(
      selectedYoutubeVideo.title,
      selectedYoutubeVideo.description,
      selectedYoutubeVideo.fileName || selectedYoutubeVideo.filename || selectedYoutubeVideo.filePath || ""
    );

    if (detected.logoName !== "none" && selectedProgramLogo === "none") {
      setSelectedProgramLogo(detected.logoName);
      setIsAutoThumbnailEnabled(true);
    }

    // Aplicar playlistId detectado usando el updater funcional para evitar closure estale.
    // Solo se aplica si el formulario todavía no tiene un playlistId asignado.
    if (detected.playlistId) {
      setUpdateForm(prev => {
        if (!prev.playlistId) {
          return { ...prev, playlistId: detected.playlistId };
        }
        return prev;
      });
    }
  }, [selectedYoutubeVideo?.id, programLogosCatalog, playlists]);

  // SINCRONIZACIÓN LOGO ↔ PLAYLIST: cuando cambia la playlist asignada al formulario,
  // actualizar automáticamente el logo al que esté vinculado en el gestor de logos.
  // Esto tiene prioridad absoluta sobre cualquier detección por palabras clave.
  useEffect(() => {
    const activePlaylistId = updateForm?.playlistId;
    if (activePlaylistId && activePlaylistId !== "" && programLogosCatalog && programLogosCatalog.length > 0) {
      const linkedLogo = programLogosCatalog.find(
        l => typeof l === "object" && l.playlistId === activePlaylistId
      );
      if (linkedLogo && linkedLogo.name) {
        setSelectedProgramLogo(linkedLogo.name);
        setIsAutoThumbnailEnabled(true);
      }
    }
  }, [updateForm?.playlistId, programLogosCatalog]);



  // Helper para obtener una URL de miniatura limpia (sin capas previas de logo o texto)
  const getCleanVideoFrameUrl = (videoThumbnailUrl, videoId) => {
    if (videoId && videoId.length === 11) {
      return `https://i.ytimg.com/vi/${videoId}/hq2.jpg`;
    }
    if (videoThumbnailUrl) {
      const match = videoThumbnailUrl.match(/(?:vi|vi_webp)\/([a-zA-Z0-9_-]{11})/);
      if (match && match[1]) {
        return `https://i.ytimg.com/vi/${match[1]}/hq2.jpg`;
      }
      const extracted = extractYoutubeId(videoThumbnailUrl);
      if (extracted && extracted.length === 11) {
        return `https://i.ytimg.com/vi/${extracted}/hq2.jpg`;
      }
    }
    return videoThumbnailUrl || "";
  };

  // Dibujar y componer la miniatura estilo TVG en un canvas en memoria
  const generateSingleAutoThumbnail = async (thumbnailTextVal, videoVal, customBgVal, selectedLogoVal) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      // 1. Dibujar Imagen de Fondo
      let bgImg = null;
      try {
        if (customBgVal) {
          try {
            bgImg = await loadImage(customBgVal);
          } catch (err) {
            console.warn("[Thumbnail Generator] Fallo al cargar customBgVal, intentando fallback:", err.message);
            if (customBgVal.includes("maxresdefault.jpg")) {
              const fallbackUrl = customBgVal.replace("maxresdefault.jpg", "hqdefault.jpg");
              try {
                bgImg = await loadImage(fallbackUrl);
              } catch (fallbackErr) {
                console.error("[Thumbnail Generator] Fallo también el fallback hqdefault:", fallbackErr.message);
              }
            }
          }
        } else {
          // Si el vídeo tiene una captura inteligente local (rawFrameBase64) guardada en la base de datos, la usamos preferiblemente
          if (videoVal?.rawFrameBase64) {
            try {
              bgImg = await loadImage(videoVal.rawFrameBase64);
            } catch (rawErr) {
              console.warn("[Thumbnail Generator] Fallo al cargar rawFrameBase64:", rawErr.message);
            }
          }

          // Si no tiene rawFrameBase64 o falló la carga, usamos el fotograma por defecto de YouTube
          if (!bgImg) {
            const cleanUrl = getCleanVideoFrameUrl(videoVal?.thumbnail, videoVal?.youtubeId || videoVal?.id);
            if (cleanUrl) {
              try {
                const proxiedUrl = (cleanUrl.startsWith("data:") || cleanUrl.startsWith("/"))
                  ? cleanUrl
                  : `/api/youtube/thumbnail-proxy?url=${encodeURIComponent(cleanUrl)}`;
                bgImg = await loadImage(proxiedUrl);
              } catch (proxyErr) {
                console.warn(`[Thumbnail Generator] Fallo al cargar fotograma de YouTube, intentando con logo de programa. Error: ${proxyErr.message}`);
              }
            }
          }
        }
      } catch (bgLoadErr) {
        console.warn("[Thumbnail Generator] No se pudo cargar la imagen de fondo, se usará gradiente:", bgLoadErr.message);
      }

      if (bgImg) {
        const canvasRatio = 1280 / 720;
        const imgRatio = bgImg.width / bgImg.height;
        let sx, sy, sw, sh;

        if (imgRatio > canvasRatio) {
          sh = bgImg.height;
          sw = sh * canvasRatio;
          sx = (bgImg.width - sw) / 2;
          sy = 0;
        } else {
          sw = bgImg.width;
          sh = sw / canvasRatio;
          sx = 0;
          sy = (bgImg.height - sh) / 2;
        }
        ctx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, 1280, 720);
      } else {
        const grad = ctx.createLinearGradient(0, 0, 1280, 720);
        grad.addColorStop(0, "#1e1b4b");
        grad.addColorStop(1, "#311042");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1280, 720);
      }

      // 2. Logotipo de la cadena (TVG) pre-enmascarado
      if (maskedTvgLogoCanvasRef.current) {
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = -4;
        ctx.shadowOffsetY = 4;
        ctx.drawImage(maskedTvgLogoCanvasRef.current, 1280 - 192, 0, 192, 192);
        ctx.restore();
      }

      // 3. Logotipo del programa (esquina superior izquierda)
      let progImg = null;
      if (selectedLogoVal === "none") {
        // Sin logo
      } else if (selectedLogoVal === "default" || selectedLogoVal === "Hora_Galega.png") {
        if (defaultProgramLogoCanvasRef.current) {
          progImg = defaultProgramLogoCanvasRef.current;
        } else {
          try {
            progImg = await loadImage(`/program_logos/${selectedLogoVal}`);
          } catch (err) {
            console.error("[Thumbnail Generator] Error cargando logo de Hora Galega:", err);
          }
        }
      } else if (selectedLogoVal) {
        try {
          progImg = await loadImage(`/program_logos/${selectedLogoVal}`);
        } catch (err) {
          console.error("[Thumbnail Generator] Error cargando logo del catálogo:", err);
        }
      }

      if (progImg) {
        const maxW = 380;
        const maxH = 160;
        let dw = progImg.width;
        let dh = progImg.height;

        if (dw > maxW) {
          dh = (maxW / dw) * dh;
          dw = maxW;
        }
        if (dh > maxH) {
          dw = (maxH / dh) * dw;
          dh = maxH;
        }
        ctx.drawImage(progImg, 40, 40, dw, dh);
      }

      // 4. Frase SEO
      if (thumbnailTextVal) {
        const cleanText = thumbnailTextVal.replace(/[\/\-\"\']/g, " ").replace(/\s+/g, " ").trim();
        const words = cleanText.toUpperCase().split(/\s+/);
        const splitIndex = Math.ceil(words.length / 2);
        const line1 = words.slice(0, splitIndex).join(" ");
        const line2 = words.slice(splitIndex).join(" ");

        ctx.save();
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";

        ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
        ctx.shadowBlur = 15;
        ctx.shadowOffsetX = 5;
        ctx.shadowOffsetY = 5;

        ctx.strokeStyle = "#000000";
        ctx.lineJoin = "round";

        const textX = 60;
        const maxWidth = 1050; // Margen derecho seguro para evitar desbordamiento

        // Medir y calcular el tamaño de fuente óptimo para que quepan ambas líneas
        let fontSize = 86;
        ctx.font = `bold ${fontSize}px Impact, Arial Black, sans-serif`;
        let w1 = line1 ? ctx.measureText(line1).width : 0;
        let w2 = line2 ? ctx.measureText(line2).width : 0;
        let maxW = Math.max(w1, w2);

        if (maxW > maxWidth) {
          fontSize = Math.floor(fontSize * (maxWidth / maxW));
          if (fontSize < 40) fontSize = 40; // Clampear a un tamaño mínimo legible
          ctx.font = `bold ${fontSize}px Impact, Arial Black, sans-serif`;
        }

        // Ajustar el grosor del contorno negro proporcionalmente al tamaño de fuente
        ctx.lineWidth = Math.max(6, Math.floor(fontSize * 0.16));

        const lineSpacing = Math.floor(fontSize * 1.1);
        const line2Y = 720 - 65;
        const line1Y = line2Y - lineSpacing;

        if (line1) {
          ctx.fillStyle = "#ffffff";
          ctx.strokeText(line1, textX, line1Y);
          ctx.fillText(line1, textX, line1Y);
        }

        if (line2) {
          ctx.fillStyle = "#f97316";
          ctx.strokeText(line2, textX, line2Y);
          ctx.fillText(line2, textX, line2Y);
        }
        ctx.restore();
      }

      return canvas.toDataURL("image/jpeg", 0.9);
    } catch (err) {
      console.error("[Thumbnail Generator] Error renderizando canvas:", err);
      return null;
    }
  };

  // Wrapper para el editor individual original
  const generateAutoThumbnail = async () => {
    if (!isAutoThumbnailEnabled || !selectedYoutubeVideo) return;
    setIsGeneratingThumbnail(true);
    const dataUrl = await generateSingleAutoThumbnail(
      thumbnailText,
      selectedYoutubeVideo,
      customBgBase64,
      selectedProgramLogo
    );
    if (dataUrl) {
      setNewThumbnailBase64(dataUrl);
    }
    setIsGeneratingThumbnail(false);
  };

  // Regenerar miniatura para un video específico del lote
  const regenerateThumbnailForIndex = async (index, updatedFields = {}, passedPrivateVideos = null) => {
    setParsedVideos(prevList => {
      const idx = prevList.findIndex(v => v.index === index);
      if (idx === -1) return prevList;

      const updatedList = [...prevList];
      const currentItem = { ...updatedList[idx], ...updatedFields };
      updatedList[idx] = currentItem;

      // Si la miniatura automática no está habilitada, no hacemos nada más.
      if (!currentItem.isAutoThumbnailEnabled) {
        return updatedList;
      }

      // Inicia la generación asíncrona pero no bloquea el estado inicial
      (async () => {
        const matchedVideo = (passedPrivateVideos || privateVideos).find(pv => pv.id === currentItem.matchedVideoId);
        const thumbBase64 = await generateSingleAutoThumbnail(
          currentItem.thumbnailText,
          matchedVideo,
          currentItem.customBgBase64,
          currentItem.selectedProgramLogo
        );

        // Cuando la miniatura esté lista, actualizamos el estado final con la imagen
        setParsedVideos(currentVideos => currentVideos.map(v => v.index === index ? { ...v, generatedThumbnailBase64: thumbBase64 || "" } : v));
      })();

      return updatedList; // Devuelve la lista con los campos de texto actualizados inmediatamente
    });
  };

  // Renderizar miniatura automáticamente ante cambios en el editor individual
  useEffect(() => {
    if (isAutoThumbnailEnabled && selectedYoutubeVideo) {
      const timer = setTimeout(() => {
        generateAutoThumbnail();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [thumbnailText, selectedProgramLogo, customBgBase64, isAutoThumbnailEnabled, selectedYoutubeVideo]);

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

  // Cargar preferencia de autoincremento desde localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem("autoIncrementVideoIndex");
      if (saved !== null) {
        setAutoIncrement(saved === "true");
      }
    }
  }, []);

  // Guardar preferencia de autoincremento en localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem("autoIncrementVideoIndex", autoIncrement.toString());
    }
  }, [autoIncrement]);

  // Recarga automática para actualizaciones programadas y listado de tareas
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      fetchScheduledUpdates();
      fetchTasks(true);
      fetchPrivateVideos();
    }, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);



  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      const data = await res.json();
      setConfig(data);
      if (data.activePdfName) {
        setSavedPdfName(data.activePdfName);
      }
    } catch (err) {
      console.error("Error al obtener la configuración:", err);
    }
  };

  const fetchPlaylists = async () => {
    setLoadingPlaylists(true);
    try {
      const res = await fetch("/api/youtube/playlists", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setPlaylists(data);
      }
    } catch (err) {
      console.error("Error al obtener listas de reproducción:", err);
    } finally {
      setLoadingPlaylists(false);
    }
  };

  const fetchChannel = async () => {
    try {
      const res = await fetch("/api/channel", { cache: "no-store" });
      const data = await res.json();
      setChannel(data);
      if (data.connected) {
        fetchPlaylists();
      }
    } catch (err) {
      console.error("Error al obtener estado del canal:", err);
    } finally {
      setLoadingChannel(false);
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

  const fetchScheduledUpdates = async () => {
    try {
      const res = await fetch("/api/videos", { cache: "no-store" });
      if (res.ok) {
        const rawData = await res.json();
        const data = rawData.map(v => ({
          ...v,
          thumbnail: v.thumbnail || v.thumbnailBase64 || `/api/videos/thumbnail?id=${v.id}`
        }));
        setDbVideos(data);
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

        // Cola de vídeos locales subidos (excluyendo los que ya están en proceso de subida o programados)
        const queue = data.filter(v => v.status === "LOCAL_DRAFT" || v.status === "EDITING");
        setLocalVideosQueue(queue);

        // Vídeos locales completados
        const completed = data.filter(v => (v.status === "COMPLETED" || v.status === "READY") && v.youtubeId);
        setCompletedLocalVideos(completed);

        // Auto-ejecutar scheduler si hay videos cuya hora ya ha pasado
        const now = new Date();
        const overdue = active.filter(v => v.status === "SCHEDULED" && v.scheduledAt && new Date(v.scheduledAt) <= now);
        if (overdue.length > 0 && !autoSchedulerRunningRef.current) {
          autoSchedulerRunningRef.current = true;
          console.log(`[Auto-Scheduler] ${overdue.length} video(s) vencido(s). Ejecutando scheduler automáticamente...`);
          try {
            await fetch("/api/scheduler", { cache: "no-store" });
            // Recargar tras ejecutar para reflejar los cambios
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

  // Buscar borradores de YouTube para la vinculación manual en el selector
  const fetchYtDraftsForSelector = async (query = "") => {
    setLoadingYtDrafts(true);
    try {
      const url = query.trim() 
        ? `/api/youtube/videos?q=${encodeURIComponent(query)}` 
        : `/api/youtube/videos`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setYtDraftSearchResults(data);
      }
    } catch (err) {
      console.error("Error al buscar borradores de YouTube:", err);
    } finally {
      setLoadingYtDrafts(false);
    }
  };

  // Efecto para buscar borradores de YouTube con debounce en el selector manual
  useEffect(() => {
    if (showYtDraftSearchDropdown && selectedYoutubeVideo) {
      const delayDebounce = setTimeout(() => {
        fetchYtDraftsForSelector(ytDraftSearchQuery);
      }, 300);
      return () => clearTimeout(delayDebounce);
    }
  }, [ytDraftSearchQuery, showYtDraftSearchDropdown, selectedYoutubeVideo]);

  // Vincular un borrador de YouTube seleccionado manualmente al vídeo en edición
  const handleLinkYoutubeDraft = async (draft) => {
    if (!selectedYoutubeVideo || !draft) return;

    if (!confirm(`¿Deseas vincular el borrador de YouTube "${draft.title}" a este contenido?`)) {
      return;
    }

    try {
      if (selectedYoutubeVideo.isBatchItem) {
        // Vinculación en el estado de React del lote
        const updatedVideo = {
          ...selectedYoutubeVideo,
          youtubeId: draft.id,
          thumbnail: selectedYoutubeVideo.thumbnail || draft.thumbnail
        };
        setSelectedYoutubeVideo(updatedVideo);

        if (draft.thumbnail) {
          const proxiedUrl = `/api/youtube/thumbnail-proxy?url=${encodeURIComponent(draft.thumbnail)}`;
          setCustomBgBase64(proxiedUrl);
        }

        setParsedVideos(prev => prev.map(v => {
          if (v.index === selectedYoutubeVideo.batchIndex) {
            return { ...v, matchedVideoId: draft.id };
          }
          return v;
        }));

        await fetchPrivateVideos();
        alert("¡Borrador de YouTube vinculado con éxito!");
        setYtDraftSearchQuery("");
        setShowYtDraftSearchDropdown(false);
        return;
      }

      const targetId = selectedYoutubeVideo.dbId || selectedYoutubeVideo.id;
      
      const res = await fetch(`/api/videos?id=${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeId: draft.id
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Fallo al vincular el borrador en la base de datos");
      }

      // Actualizar el estado local selectedYoutubeVideo
      const updatedVideo = {
        ...selectedYoutubeVideo,
        youtubeId: draft.id,
        thumbnail: selectedYoutubeVideo.thumbnail || draft.thumbnail
      };
      setSelectedYoutubeVideo(updatedVideo);

      // Usar miniatura como preview de fondo
      if (draft.thumbnail) {
        const proxiedUrl = `/api/youtube/thumbnail-proxy?url=${encodeURIComponent(draft.thumbnail)}`;
        setCustomBgBase64(proxiedUrl);
      }

      // Actualizar estados locales de listas de videos
      setDbVideos(prev => prev.map(v => v.id === targetId ? { ...v, youtubeId: draft.id } : v));
      setLocalVideosQueue(prev => prev.map(v => v.id === targetId ? { ...v, youtubeId: draft.id } : v));

      // Actualizar parsedVideos
      setParsedVideos(prev => prev.map(v => {
        if (v.index === selectedYoutubeVideo.index || v.matchedVideoId === targetId) {
          return { ...v, matchedVideoId: draft.id };
        }
        return v;
      }));

      await fetchScheduledUpdates();
      await fetchPrivateVideos();

      alert("¡Borrador de YouTube vinculado con éxito!");
      setYtDraftSearchQuery("");
      setShowYtDraftSearchDropdown(false);
    } catch (err) {
      console.error(err);
      alert("Error al vincular el borrador: " + err.message);
    }
  };

  // Guardar configuración
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configInput),
      });

      if (!res.ok) throw new Error("Error al guardar.");

      alert("Configuración guardada.");
      setShowSettings(false);
      setConfigInput({ GEMINI_API_KEY: "", YOUTUBE_CLIENT_ID: "", YOUTUBE_CLIENT_SECRET: "" });
      await fetchConfig();
      await fetchChannel();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setSavingConfig(false);
    }
  };

  // Desconectar canal
  const disconnectChannel = async () => {
    if (window.confirm("¿Estás seguro de que deseas desconectar el canal?")) {
      try {
        const res = await fetch("/api/channel", { method: "DELETE" });
        if (res.ok) {
          setChannel({ connected: false, channel: null });
        }
      } catch (err) {
        alert("Error al desconectar.");
      }
    }
  };

  // Seleccionar item de lote parsedVideos para edición individual
  const handleSelectBatchItemForEditing = async (item) => {
    // Buscar si el matchedVideoId tiene correspondencia en privateVideos para obtener la miniatura original
    const ytVideo = privateVideos.find(pv => pv.id === item.matchedVideoId);
    const dbVideo = dbVideos.find(v => v.youtubeId === item.matchedVideoId);
    
    const combinedVideo = {
      id: item.matchedVideoId || `temp-${item.index}`,
      youtubeId: item.matchedVideoId || '',
      title: item.title,
      description: item.description,
      thumbnail: item.generatedThumbnailBase64 || ytVideo?.thumbnail || '',
      isBatchItem: true,
      batchIndex: item.index,
      fileName: ytVideo?.fileName || '',
      filePath: dbVideo?.filePath || null,
      dbId: dbVideo?.id || null
    };

    setSelectedYoutubeVideo(combinedVideo);
    // Pasar la fecha sugerida por el subidor (si existe) para mostrar el banner en el editor
    setSuggestedScheduledAt(item.scheduledAt || null);

    // Detectar si el título ya tiene un emoji guardado al principio
    let extractedEmoji = "";
    const emojiMatch = item.title.match(/^([\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/u);
    if (emojiMatch) {
      extractedEmoji = emojiMatch[1];
    }
    const logoName = item.selectedProgramLogo || 'none';

    // Generar el título inicial con el emoji del principio (y limpiar cualquier emoji al final)
    const updatedTitle = updateTitleSuffix(item.title, logoName, extractedEmoji);

    setUpdateForm({
      title: updatedTitle,
      description: item.description,
      tags: item.tags || '',
      isScheduled: false,
      scheduledAt: '',
      playlistId: item.playlistId || ''
    });

    setThumbnailText(item.thumbnailText || '');
    setIsAutoThumbnailEnabled(item.isAutoThumbnailEnabled !== undefined ? item.isAutoThumbnailEnabled : true);
    setSelectedProgramLogo(logoName);

    setCurrentEmoji(extractedEmoji);
    if (logoName && logoName !== "none" && !extractedEmoji) {
      fetchEmojiForTitle(item.title, item.description || "").then(emoji => {
        if (emoji) {
          setCurrentEmoji(emoji);
          setUpdateForm(prev => {
            const newTitle = updateTitleSuffix(prev.title, logoName, emoji);
            return { ...prev, title: newTitle };
          });
        }
      });
    }
    
    // Configurar imagen de fondo personalizada
    if (item.customBgBase64) {
      setCustomBgBase64(item.customBgBase64);
    } else if (dbVideo?.rawFrameBase64) {
      setCustomBgBase64(dbVideo.rawFrameBase64);
    } else if (combinedVideo.filePath && !['PDF_PARSED', 'YOUTUBE_UPLOAD', 'YOUTUBE_UPDATE'].includes(combinedVideo.filePath)) {
      if (!combinedVideo.filePath.startsWith('https://')) {
        setIsExtractingFrame(true);
        extractVideoFrame(`/api/videos/stream?id=${combinedVideo.dbId}`)
          .then(frame => {
            setCustomBgBase64(frame);
          })
          .catch(err => {
            console.error("Error al extraer fotograma del vídeo local en lote:", err);
          })
          .finally(() => {
            setIsExtractingFrame(false);
          });
      }
    } else {
      setCustomBgBase64(null);
    }

    setNewThumbnailBase64(item.generatedThumbnailBase64 || null);
    setOptimizationSuggestions(null);

    // Cargar el vídeo en el elemento oculto para permitir el ajuste manual del fotograma si existe el archivo
    if (combinedVideo.filePath && !['PDF_PARSED', 'YOUTUBE_UPLOAD', 'YOUTUBE_UPDATE'].includes(combinedVideo.filePath)) {
      const srcUrl = combinedVideo.filePath.startsWith('https://') 
        ? combinedVideo.filePath 
        : `/api/videos/stream?id=${combinedVideo.dbId}`;
      
      if (videoObjectURL) {
        URL.revokeObjectURL(videoObjectURL);
      }
      setVideoObjectURL("");
      
      if (hiddenVideoRef.current) {
        hiddenVideoRef.current.src = srcUrl;
        hiddenVideoRef.current.load();
      }
    }
  };

  // Seleccionar video e inicializar formulario
  const handleSelectVideo = async (video) => {
    setYoutubeId(video.id);

    // Buscar si hay un registro correspondiente en nuestra base de datos local.
    // Puede haber múltiples registros para el mismo youtubeId (el original con filePath local
    // y uno secundario con filePath='YOUTUBE_UPDATE' para el scheduler). Priorizamos el que
    // tiene un filePath local real para que el slider de fotograma funcione.
    let dbVideo = null;
    try {
      const res = await fetch("/api/videos", { cache: "no-store" });
      if (res.ok) {
        const dbVideos = await res.json();
        const matches = dbVideos.filter(v => v.youtubeId === video.id);
        // Primero intentar coger el que tiene un filePath real (no YOUTUBE_UPDATE, no null)
        dbVideo = matches.find(v =>
          v.filePath &&
          !['YOUTUBE_UPDATE', 'YOUTUBE_UPLOAD', 'PDF_PARSED'].includes(v.filePath)
        ) || matches[0] || null;
      }
    } catch (err) {
      console.warn("No se pudo buscar el video en la base de datos local:", err.message);
    }

    // Actualizar el estado en BD a EDITING para informar a otros usuarios
    if (dbVideo && dbVideo.status === "LOCAL_DRAFT") {
      try {
        await fetch(`/api/videos?id=${dbVideo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "EDITING" })
        });
        fetchScheduledUpdates();
      } catch (err) {
        console.error("Error setting video status to EDITING:", err);
      }
    }

    const combinedVideo = {
      ...video,
      rawFrameBase64: dbVideo?.rawFrameBase64 || null,
      filePath: dbVideo?.filePath || null,
      dbId: dbVideo?.id || null,
      hasExtractedFrames: dbVideo?.hasExtractedFrames || false
    };

    setSelectedYoutubeVideo(combinedVideo);
    setSuggestedScheduledAt(dbVideo?.scheduledAt || null);

    // Buscar si ya hay una actualización programada para este video
    const scheduledUpdate = scheduledUpdates.find(u => u.youtubeId === video.id);

    // Auto-detectar programa y playlist utilizando nuestro nuevo helper
    const initialTitle = dbVideo?.title || video.title || "";
    const initialDesc = dbVideo?.description || video.description || "";
    const initialPlaylistId = dbVideo?.playlistId || "";

    const detected = detectProgramAndPlaylist(
      initialTitle,
      initialDesc,
      video.fileName || video.filename || dbVideo?.filename || ""
    );
    const detectedPlaylistId = initialPlaylistId || detected.playlistId;
    const detectedLogo = detected.logoName;

    // Detectar si el título ya tiene un emoji guardado al principio
    let extractedEmoji = "";
    const titleToCheck = dbVideo?.title || video.title || "";
    const emojiMatch = titleToCheck.match(/^([\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/u);
    if (emojiMatch) {
      extractedEmoji = emojiMatch[1];
    }

    // Generar el título y descripción iniciales
    const updatedTitle = updateTitleSuffix(initialTitle, detectedLogo, extractedEmoji);
    const updatedDesc = dbVideo?.description ? dbVideo.description : updateDescriptionUrl(initialDesc, detectedLogo);

    setUpdateForm({
      title: updatedTitle,
      description: updatedDesc,
      tags: dbVideo?.tags || video.tags || "",
      isScheduled: !!scheduledUpdate,
      scheduledAt: scheduledUpdate && scheduledUpdate.scheduledAt
        ? toLocalDateTimeString(scheduledUpdate.scheduledAt)
        : "",
      playlistId: detectedPlaylistId || ""
    });
    setOptimizationSuggestions(null);
    handleResetThumbnailStates();

    setCurrentEmoji(extractedEmoji);
    if (detectedLogo && detectedLogo !== "none" && !extractedEmoji) {
      fetchEmojiForTitle(initialTitle, initialDesc).then(emoji => {
        if (emoji) {
          setCurrentEmoji(emoji);
          setUpdateForm(prev => {
            const newTitle = updateTitleSuffix(prev.title, detectedLogo, emoji);
            return { ...prev, title: newTitle };
          });
        }
      });
    }

    // Cargar el vídeo en el elemento oculto para permitir el ajuste manual del fotograma si existe el archivo, o usar fotogramas del servidor
    if (dbVideo && dbVideo.hasExtractedFrames) {
      const count = dbVideo.extractedFramesCount || 8;
      const serverFrames = [];
      for (let i = 0; i < count; i++) {
        serverFrames.push(`/api/videos/thumbnail?id=${dbVideo.id}&frame=${i}`);
      }
      setCapturedFrames(serverFrames);
      setVideoDuration(1); // Hacer que hasLocalVideo sea true para el renderizado
      setIsExtractingFrames(false);
    } else {
      const validFilePath = combinedVideo.filePath &&
        !['PDF_PARSED', 'YOUTUBE_UPLOAD', 'YOUTUBE_UPDATE'].includes(combinedVideo.filePath);

      if (validFilePath && combinedVideo.dbId) {
        const srcUrl = combinedVideo.filePath.startsWith('https://')
          ? combinedVideo.filePath
          : `/api/videos/stream?id=${combinedVideo.dbId}`;

        if (videoObjectURL) URL.revokeObjectURL(videoObjectURL);
        setVideoObjectURL("");

        if (hiddenVideoRef.current) {
          hiddenVideoRef.current.src = srcUrl;
          hiddenVideoRef.current.load();
        }
      }
    }

    // Establecer el fotograma de fondo (prioridad base64 local sobre YouTube proxy)
    if (combinedVideo.rawFrameBase64) {
      setCustomBgBase64(combinedVideo.rawFrameBase64);
    } else {
      // Priorizar la miniatura real que viene de YouTube (video.thumbnail), o caer en hqdefault.jpg
      const directUrl = video.thumbnail || `https://img.youtube.com/vi/${video.id}/hqdefault.jpg`;
      const proxiedUrl = `/api/youtube/thumbnail-proxy?url=${encodeURIComponent(directUrl)}`;
      setCustomBgBase64(proxiedUrl);
    }
    
    // Asignar el logotipo detectado y habilitar miniatura automática si es distinto de "none"
    if (detectedLogo !== "none") {
      setSelectedProgramLogo(detectedLogo);
      setIsAutoThumbnailEnabled(true);

      // Auto-generar frase SEO con Gemini
      if (updatedTitle) {
        setIsGeneratingSeoPhrase(true);
        fetch("/api/youtube/generate-seo-phrase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: updatedTitle, description: updatedDesc })
        })
          .then(res => res.ok ? res.json() : null)
          .then(seoData => {
            if (seoData && seoData.thumbnailText) {
              setThumbnailText(seoData.thumbnailText);
            }
          })
          .catch(err => console.error("Error al generar la frase SEO en autocompletado:", err))
          .finally(() => setIsGeneratingSeoPhrase(false));
      }
    }
  };

  // Seleccionar video local e inicializar formulario con autocompletados
  const handleSelectLocalVideo = async (video) => {
    setSelectedYoutubeVideo({
      id: video.id,
      youtubeId: video.youtubeId || null, // Guardar el ID de YouTube si ya se subió
      title: video.title || "",
      description: video.description || "",
      tags: video.tags || "",
      playlistId: video.playlistId || "",
      scheduledAt: video.scheduledAt || null,
      isLocal: !video.youtubeId, // Si ya se subió a YouTube, no lo tratamos como local
      filePath: video.filePath,
      fileName: video.filename || video.filePath || "",
      createdAt: video.createdAt,
      rawFrameBase64: video.rawFrameBase64 || null
    });
    setYoutubeId(video.id);

    // Auto-detectar programa y playlist utilizando nuestro nuevo helper
    const detected = detectProgramAndPlaylist(video.title, video.description, video.filename || video.filePath || "");
    const detectedPlaylistId = detected.playlistId || "";
    const detectedLogo = detected.logoName;

    // Detectar si el título ya tiene un emoji guardado al principio
    let extractedEmoji = "";
    const rawTitle = video.title || "";
    const emojiMatch = rawTitle.match(/^([\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/u);
    if (emojiMatch) {
      extractedEmoji = emojiMatch[1];
    }

    const updatedTitle = updateTitleSuffix(rawTitle, detectedLogo, extractedEmoji);

    const rawDesc = video.description || "";
    const updatedDesc = updateDescriptionUrl(rawDesc, detectedLogo);

    setUpdateForm({
      title: updatedTitle,
      description: updatedDesc,
      tags: video.tags || "",
      isScheduled: !!video.scheduledAt,
      scheduledAt: video.scheduledAt ? toLocalDateTimeString(video.scheduledAt) : "",
      playlistId: detectedPlaylistId
    });
    handleResetThumbnailStates();

    setCurrentEmoji(extractedEmoji);
    if (detectedLogo && detectedLogo !== "none" && !extractedEmoji) {
      fetchEmojiForTitle(rawTitle, rawDesc).then(emoji => {
        if (emoji) {
          setCurrentEmoji(emoji);
          setUpdateForm(prev => {
            const newTitle = updateTitleSuffix(prev.title, detectedLogo, emoji);
            return { ...prev, title: newTitle };
          });
        }
      });
    }

    // Actualizar el estado en BD a EDITING para informar a otros usuarios
    if (video.status === "LOCAL_DRAFT") {
      try {
        await fetch(`/api/videos?id=${video.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "EDITING" })
        });
        fetchScheduledUpdates();
      } catch (err) {
        console.error("Error setting video status to EDITING:", err);
      }
    }

    // Cargar el vídeo en el elemento oculto para permitir el ajuste manual del fotograma si es necesario
    if (video.hasExtractedFrames) {
      const count = video.extractedFramesCount || 6;
      const serverFrames = [];
      for (let i = 0; i < count; i++) {
        serverFrames.push(`/api/videos/thumbnail?id=${video.id}&frame=${i}`);
      }
      setCapturedFrames(serverFrames);
      setVideoDuration(1); // Hacer que hasLocalVideo sea true para el renderizado
      setIsExtractingFrames(false);
    } else if (video.filePath && !['PDF_PARSED', 'YOUTUBE_UPLOAD', 'YOUTUBE_UPDATE'].includes(video.filePath)) {
      const srcUrl = video.filePath.startsWith('https://') 
        ? video.filePath 
        : `/api/videos/stream?id=${video.id}`;
      
      if (videoObjectURL) {
        URL.revokeObjectURL(videoObjectURL);
      }
      setVideoObjectURL("");
      
      if (hiddenVideoRef.current) {
        hiddenVideoRef.current.src = srcUrl;
        hiddenVideoRef.current.load();
      }
    }

    let rawFrame = video.rawFrameBase64 || null;
    if (rawFrame && rawFrame.startsWith('[')) {
      try {
        const parsed = JSON.parse(rawFrame);
        rawFrame = parsed[0] || null;
      } catch (e) {
        rawFrame = null;
      }
    }
    if (rawFrame) {
      setCustomBgBase64(rawFrame);
    } else if (video.hasExtractedFrames) {
      setCustomBgBase64(`/api/videos/thumbnail?id=${video.id}&frame=0`);
    } else if (video.filePath && video.filePath.startsWith('https://')) {
      // El video está en Supabase Storage: no podemos hacer streaming local.
      // Si tiene un rawFrameBase64 guardado, ya se usó arriba. Si no, dejamos sin fondo.
      // No intentamos stream local para evitar errores.
    } else if (video.filePath && !['PDF_PARSED', 'YOUTUBE_UPLOAD', 'YOUTUBE_UPDATE'].includes(video.filePath)) {
      setIsExtractingFrame(true);
      extractVideoFrame(`/api/videos/stream?id=${video.id}`)
        .then(frame => {
          setCustomBgBase64(frame);
        })
        .catch(err => {
          console.error("Error al extraer fotograma del vídeo local:", err);
        })
        .finally(() => {
          setIsExtractingFrame(false);
        });
    } else if (video.youtubeId) {
      // Fallback: usar la miniatura por defecto que genera YouTube para este vídeo a través del proxy de CORS
      const directUrl = video.thumbnail || `https://img.youtube.com/vi/${video.youtubeId}/hqdefault.jpg`;
      const proxiedUrl = `/api/youtube/thumbnail-proxy?url=${encodeURIComponent(directUrl)}`;
      setCustomBgBase64(proxiedUrl);
    }
    
    if (detectedLogo !== "none") {
      setSelectedProgramLogo(detectedLogo);
      setIsAutoThumbnailEnabled(true);

      // Generar frase SEO de 4 palabras automáticamente
      if (updatedTitle) {
        setIsGeneratingSeoPhrase(true);
        try {
          const res = await fetch("/api/youtube/generate-seo-phrase", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: updatedTitle, description: updatedDesc })
          });
          if (res.ok) {
            const seoData = await res.json();
            if (seoData.thumbnailText) {
              setThumbnailText(seoData.thumbnailText);
            }
          }
        } catch (err) {
          console.error("Error al generar la frase SEO en autocompletado:", err);
        } finally {
          setIsGeneratingSeoPhrase(false);
        }
      }
    }
  };

  // Auto-seleccionar video para editar si viene un editId en la URL
  useEffect(() => {
    if (!isAuthenticated) return;
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get("editId");
    if (editId) {
      const selectVideoFromUrl = async () => {
        try {
          const res = await fetch(`/api/videos?id=${editId}`, { cache: "no-store" });
          if (res.ok) {
            const video = await res.json();
            handleSelectLocalVideo(video);
            // Limpiar el parámetro de la URL
            window.history.replaceState({}, document.title, "/editor");
          }
        } catch (err) {
          console.error("Error al cargar vídeo para editar desde URL:", err);
        }
      };
      selectVideoFromUrl();
    }
  }, [isAuthenticated]);

  // Optimizar título/descripción con IA en caliente
  const handleOptimizeFieldWithAI = async (text, field, setFieldFn, setLoaderFn) => {
    if (!text || !text.trim()) {
      alert("Introduce algún texto primero para optimizar.");
      return;
    }

    // Si es un título, extraer el sufijo y el emoji para reañadirlos después de la optimización IA
    let suffix = "";
    let emojiPrefix = "";
    let textToOptimize = text;
    if (field === 'title') {
      // 1. Extraer el emoji del inicio
      const emojiMatch = text.match(/^([\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])\s*/u);
      if (emojiMatch) {
        emojiPrefix = emojiMatch[0]; // Ej.: "🚨 "
        textToOptimize = text.substring(emojiPrefix.length).trim();
      } else if (currentEmoji) {
        emojiPrefix = currentEmoji + " ";
      }

      // 2. Extraer el sufijo
      const pipeIndex = textToOptimize.lastIndexOf(" | ");
      if (pipeIndex !== -1) {
        suffix = textToOptimize.substring(pipeIndex); // Ej.: " | HORA GALEGA"
        textToOptimize = textToOptimize.substring(0, pipeIndex).trim();
      }
    } else if (field === 'description') {
      // Intentar encontrar el bloque de redes sociales para extraerlo
      const socialIndex = text.indexOf("Podes ver o programa completo");
      if (socialIndex !== -1) {
        suffix = "\n\n" + text.substring(socialIndex).trim();
        textToOptimize = text.substring(0, socialIndex).trim();
      } else {
        const tvgIndex = text.indexOf("tvg.gal/");
        if (tvgIndex !== -1) {
          const paragraphStart = text.lastIndexOf("\n\n", tvgIndex);
          if (paragraphStart !== -1) {
            suffix = text.substring(paragraphStart);
            textToOptimize = text.substring(0, paragraphStart).trim();
          } else {
            const lineStart = text.lastIndexOf("\n", tvgIndex);
            if (lineStart !== -1) {
              suffix = text.substring(lineStart);
              textToOptimize = text.substring(0, lineStart).trim();
            } else {
              suffix = "\n\n" + text.substring(tvgIndex).trim();
              textToOptimize = text.substring(0, tvgIndex).trim();
            }
          }
        }
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
          // Reañadir el emoji al inicio y el sufijo del programa al final
          setFieldFn(emojiPrefix + data.optimizedText + suffix);
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

    setSimpleUploadStatus("🎞️ Extrayendo fotogramas del vídeo...");
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

  // Subida de vídeo directa a YouTube (Resumible)
  // Subida de vídeo a Supabase Storage (para dejarlo En Pendiente)
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
    setSimpleUploadStatus("Iniciando subida de vídeo...");
    let uploadQueueId = null;

    try {
      const file = simpleVideoFile;

      // 1. Subir archivo a Supabase Storage mediante XMLHttpRequest
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("Las credenciales de Supabase no están configuradas en el entorno (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).");
      }

      // Generar una carpeta única para evitar colisiones de archivos del mismo nombre
      const fileId = generateUUID();
      uploadQueueId = fileId;
      const storagePath = `${fileId}/${file.name}`;
      const uploadUrl = `${supabaseUrl}/storage/v1/object/videos/${storagePath}`;
      setScheduledUpdates(prev => [
        {
          id: fileId,
          filename: file.name,
          title: simpleTitle,
          description: simpleDescription,
          status: "UPLOADING",
          uploadProgress: 0,
          scheduledAt: null,
          privacyStatus: "private",
          youtubeId: null
        },
        ...prev.filter(item => item.id !== fileId)
      ]);

      console.log(`[Supabase Upload] Subiendo a: ${uploadUrl}`);

      const publicVideoUrl = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadUrl, true);
        xhr.setRequestHeader("Authorization", `Bearer ${supabaseAnonKey}`);
        xhr.setRequestHeader("apikey", supabaseAnonKey);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");

        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const percent = Math.round((evt.loaded / evt.total) * 100);
            setSimpleUploadProgress(percent);
            setSimpleUploadStatus(`Subiendo archivo a la nube: ${percent}%...`);
            setScheduledUpdates(prev => prev.map(item =>
              item.id === fileId ? { ...item, uploadProgress: percent } : item
            ));
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 201) {
            const publicUrl = `${supabaseUrl}/storage/v1/object/public/videos/${storagePath}`;
            resolve(publicUrl);
          } else {
            reject(new Error(`Supabase rechazó la subida: ${xhr.status} ${xhr.statusText} (${xhr.responseText})`));
          }
        };

        xhr.onerror = () => {
          reject(new Error("Error de conexión al subir el vídeo a la nube."));
        };

        xhr.send(file);
      });

      // 2. Guardar registro del vídeo en la base de datos local como READY (Pendiente)
      setSimpleUploadStatus("Guardando registro en la base de datos...");
      const saveRes = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          filePath: publicVideoUrl, // Se guarda la URL de Supabase
          title: simpleTitle,
          description: simpleDescription,
          rawFrameBase64: localExtractedFrame,
          playlistId: "",
          scheduledAt: isSimpleScheduled && simpleScheduledAt ? toUTCISOString(simpleScheduledAt) : null
        })
      });

      if (!saveRes.ok) {
        const errData = await saveRes.json();
        throw new Error(errData.error || "Fallo al guardar el vídeo en la cola de pendientes");
      }

      setSimpleUploadStatus("¡Subida completada con éxito!");
      alert("¡Vídeo subido con éxito y guardado en la cola de pendientes para los editores!");
      
      // Limpiar formulario y refrescar lista
      setSimpleVideoFile(null);
      setLocalExtractedFrame(null);
      setSimpleTitle("");
      setSimpleDescription("");
      setIsSimpleScheduled(false);
      setSimpleScheduledAt("");
      if (simpleVideoInputRef.current) {
        simpleVideoInputRef.current.value = "";
      }
      setScheduledUpdates(prev => prev.filter(item => item.id !== fileId));
      fetchScheduledUpdates();
    } catch (err) {
      console.error(err);
      setSimpleUploadStatus(`Error: ${err.message}`);
      alert(`Error en la subida: ${err.message}`);
      if (uploadQueueId) {
        setScheduledUpdates(prev => prev.filter(item => item.id !== uploadQueueId));
      }
    } finally {
      setIsSimpleUploading(false);
      setSimpleUploadProgress(0);
    }
  };

  // Guardar lote parseado de PDF en la base de datos local
  const handleSaveBatchToDb = async () => {
    if (parsedVideos.length === 0) {
      alert("No hay ningún vídeo en el lote para guardar.");
      return;
    }
    
    if (!confirm(`Se van a guardar ${parsedVideos.length} vídeos en la base de datos local para que los editores puedan editarlos y publicarlos. ¿Deseas continuar?`)) {
      return;
    }

    setIsSyncingBatch(true);
    setSyncProgress({ current: 0, total: parsedVideos.length, status: "Guardando lote en base de datos..." });

    try {
      let count = 0;
      for (const item of parsedVideos) {
        count++;
        setSyncProgress({
          current: count,
          total: parsedVideos.length,
          status: `Guardando vídeo ${item.index}: "${item.title}"...`
        });

        const res = await fetch("/api/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: item.title,
            description: item.description,
            filename: `Lote PDF - ${item.index}`,
            filePath: 'PDF_PARSED',
            playlistId: item.playlistId || null
          })
        });

        if (!res.ok) {
          throw new Error(`Fallo al guardar el vídeo ${item.index}`);
        }
      }

      alert("¡Lote de vídeos guardado con éxito en la base de datos!");
      setParsedVideos([]);
      setDocumentFiles([]);
      fetchScheduledUpdates();
    } catch (err) {
      alert("Error al guardar lote: " + err.message);
    } finally {
      setIsSyncingBatch(false);
    }
  };

  // Cargar una tarea pendiente en el editor
  const handleWorkOnTask = async (task) => {
    if (task.isLocal) {
      const el = document.getElementById(`batch-video-${task.index}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'box-shadow 0.3s ease';
        el.style.boxShadow = '0 0 25px rgba(168, 85, 247, 0.8)';
        setTimeout(() => {
          el.style.boxShadow = '';
        }, 2500);
      }
      return;
    }
    setYoutubeId(task.youtubeId);
    setLoadingYoutubeVideo(true);
    try {
      const res = await fetch(`/api/youtube/videos?q=${encodeURIComponent(task.youtubeId)}`);
      if (!res.ok) throw new Error("Fallo al buscar el video");
      const data = await res.json();
      if (data.length > 0) {
        const video = data[0];
        setSelectedYoutubeVideo(video);

        // Buscar si ya hay una actualización programada para este video
        const scheduledUpdate = scheduledUpdates.find(u => u.youtubeId === task.youtubeId);

        // Auto-detectar programa y playlist utilizando nuestro nuevo helper
        const detected = detectProgramAndPlaylist(task.title || video.title, task.description || video.description, task.filename || video.fileName || "");
        const detectedPlaylistId = detected.playlistId || "";
        const detectedLogo = detected.logoName;

        const updatedTitle = updateTitleSuffix(task.title || video.title || "", detectedLogo);
        const updatedDesc = updateDescriptionUrl(task.description || video.description || "", detectedLogo);

        // Detectar si el título ya tiene un emoji guardado al principio
        let extractedEmoji = "";
        const taskTitle = task.title || video.title || "";
        const taskDesc = task.description || video.description || "";
        const emojiMatch = taskTitle.match(/^([\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/u);
        if (emojiMatch) {
          extractedEmoji = emojiMatch[1];
        }

        setUpdateForm({
          title: updatedTitle,
          description: updatedDesc,
          tags: video.tags || "",
          isScheduled: !!scheduledUpdate,
          scheduledAt: scheduledUpdate && scheduledUpdate.scheduledAt
            ? toUTCISOString(scheduledUpdate.scheduledAt)
            : "",
          playlistId: detectedPlaylistId
        });
        setOptimizationSuggestions(null);
        handleResetThumbnailStates();

        setCurrentEmoji(extractedEmoji);
        if (detectedLogo && detectedLogo !== "none" && !extractedEmoji) {
          fetchEmojiForTitle(taskTitle, taskDesc).then(emoji => {
            if (emoji) {
              setCurrentEmoji(emoji);
              setUpdateForm(prev => {
                const newTitle = updateTitleSuffix(prev.title, detectedLogo, emoji);
                return { ...prev, title: newTitle };
              });
            }
          });
        }
        
        if (detectedLogo !== "none") {
          setSelectedProgramLogo(detectedLogo);
          setIsAutoThumbnailEnabled(true);
          
          // Cargar miniatura automática con la frase SEO guardada o el fallback por defecto
          if (task.thumbnailText) {
            setThumbnailText(task.thumbnailText);
          } else if (updatedTitle) {
            setIsGeneratingSeoPhrase(true);
            try {
              const res = await fetch("/api/youtube/generate-seo-phrase", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: updatedTitle, description: updatedDesc })
              });
              if (res.ok) {
                const seoData = await res.json();
                if (seoData.thumbnailText) {
                  setThumbnailText(seoData.thumbnailText);
                }
              }
            } catch (err) {
              console.error("Error al generar la frase SEO en autocompletado:", err);
            } finally {
              setIsGeneratingSeoPhrase(false);
            }
          }
        }
      } else {
        alert("No se encontró el video de la tarea en YouTube.");
      }
    } catch (err) {
      alert("Error al cargar el video: " + err.message);
    } finally {
      setLoadingYoutubeVideo(false);
    }
  };

  // Obtener videos privados del canal de YouTube
  const fetchPrivateVideos = async () => {
    try {
      const ytRes = await fetch("/api/youtube/videos", { cache: "no-store" });
      if (ytRes.ok) {
        const activePrivateVideos = await ytRes.json();
        setPrivateVideos(activePrivateVideos);
        return activePrivateVideos;
      } else {
        console.warn("No se pudieron cargar los videos privados del canal.");
      }
    } catch (ytErr) {
      console.warn("YouTube video fetch failed:", ytErr.message);
    }
    return [];
  };

  // Buscar videos en YouTube para vincular a un item del editor en lote
  const handleBatchVideoSearch = async (index, query) => {
    if (!query || !query.trim()) return;
    setBatchVideoSearch(prev => ({ ...prev, [index]: { ...prev[index], query, loading: true, results: [] } }));
    try {
      const res = await fetch(`/api/youtube/videos?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setBatchVideoSearch(prev => ({ ...prev, [index]: { query, results: data, loading: false } }));
      } else {
        setBatchVideoSearch(prev => ({ ...prev, [index]: { query, results: [], loading: false } }));
      }
    } catch {
      setBatchVideoSearch(prev => ({ ...prev, [index]: { query, results: [], loading: false } }));
    }
  };

  // Analizar los documentos (PDF o Word) con Gemini e iniciar mapeo automático
  const handleAnalyzeFile = async (e) => {
    e.preventDefault();
    if (!documentFiles || documentFiles.length === 0) {
      alert("Por favor, sube uno o varios documentos PDF o Word de referencia.");
      return;
    }

    setIsAnalyzingFile(true);
    setAnalyzeProgress(5);
    setParsedVideos([]);

    const progressInterval = setInterval(() => {
      setAnalyzeProgress((prev) => {
        if (prev >= 95) return 95;
        const step = prev < 50 ? 8 : (prev < 80 ? 4 : 1);
        return Math.min(prev + step, 95);
      });
    }, 500);

    try {
      // 1. Obtener la lista de videos privados/ocultos de YouTube
      const activePrivateVideos = await fetchPrivateVideos();

      // 2. Analizar los archivos (PDF o Word)
      const formData = new FormData();
      documentFiles.forEach(file => {
        formData.append("file", file);
      });
      formData.append("youtubeVideos", JSON.stringify(activePrivateVideos));

      const res = await fetch("/api/youtube/analyze-pdf", {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fallo al procesar el documento");
      }

      const data = await res.json();

      // 3. Emparejamiento inicial usando todas las fases
      const matchedMap = new Map(); // Mapea v.index -> video del editor (de activePrivateVideos o localVideosQueue)
      const alreadyMatchedEditorIds = new Set(); // Evitar duplicados

      // Fase 1: Coincidencia directa por ID de Gemini
      for (const v of data.videos) {
        if (v.matchedVideoId) {
          // Buscar primero en activePrivateVideos (YouTube)
          let match = activePrivateVideos.find(pv => pv.id === v.matchedVideoId && !alreadyMatchedEditorIds.has(pv.id));
          // Si no está, buscar en localVideosQueue (local DB)
          if (!match) {
            match = localVideosQueue.find(ld => (ld.id === v.matchedVideoId || ld.youtubeId === v.matchedVideoId) && !alreadyMatchedEditorIds.has(ld.id));
          }
          if (match) {
            matchedMap.set(v.index, match);
            alreadyMatchedEditorIds.add(match.id);
          }
        }
      }

      // Fase 2: Coincidencia por número de índice exacto en el nombre del archivo (para localVideosQueue)
      for (const ld of localVideosQueue) {
        if (alreadyMatchedEditorIds.has(ld.id)) continue;
        const cleanFilename = (ld.filename || ld.fileName || "").toLowerCase();
        const numberMatch = cleanFilename.match(/(?:^|\D)(\d+)(?:\D|$)/);
        if (numberMatch) {
          const fileIndex = parseInt(numberMatch[1], 10);
          const match = data.videos.find(v => v.index === fileIndex && !matchedMap.has(v.index));
          if (match) {
            matchedMap.set(match.index, ld);
            alreadyMatchedEditorIds.add(ld.id);
          }
        }
      }

      // Fase 3: Coincidencia por siglas y palabras clave (para localVideosQueue)
      for (const ld of localVideosQueue) {
        if (alreadyMatchedEditorIds.has(ld.id)) continue;
        const cleanFilename = (ld.filename || ld.fileName || "").toLowerCase();
        
        let bestCandidate = null;
        let bestScore = 0;

        for (const v of data.videos) {
          if (matchedMap.has(v.index)) continue;
          const progName = (v.programName || "").toLowerCase().trim();
          if (!progName) continue;
          
          // Siglas del programa (por ejemplo, "land rober" -> "lr")
          const initials = progName
            .split(/\s+/)
            .filter(w => !["de", "o", "a", "e", "os", "as", "do", "da", "dos", "das"].includes(w))
            .map(w => w[0])
            .join("");

          const slugProg = slugify(progName);
          const slugFile = slugify(cleanFilename);

          let score = 0;
          if (slugFile.includes(slugProg) && slugProg.length > 2) {
            score = 100;
          } else if (initials.length >= 2 && new RegExp(`(^|[^a-z])${initials}([^a-z]|$)`, "i").test(cleanFilename)) {
            score = 80;
          }

          // Si hay varias partes o palabras clave en el título
          const cleanTitle = (v.title || "").toLowerCase();
          const titleWords = cleanTitle.replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 3);
          let matchCount = 0;
          for (const word of titleWords) {
            if (cleanFilename.includes(word)) matchCount++;
          }
          score += matchCount * 10;

          if (score > bestScore) {
            bestScore = score;
            bestCandidate = v;
          }
        }

        if (bestCandidate && bestScore >= 50) {
          matchedMap.set(bestCandidate.index, ld);
          alreadyMatchedEditorIds.add(ld.id);
        }
      }

      // Fase 4: Coincidencia visual por fotograma de Gemini Vision (para localVideosQueue)
      for (const ld of localVideosQueue) {
        if (alreadyMatchedEditorIds.has(ld.id)) continue;
        if (!ld.rawFrameBase64) continue;

        // Candidatos de la escaleta aún no emparejados
        const unmatchedCandidates = data.videos.filter(v => !matchedMap.has(v.index));

        if (unmatchedCandidates.length > 0) {
          console.log(`[handleAnalyzeFile] Intentando emparejamiento visual para el vídeo local ${ld.filename || ld.id} con ${unmatchedCandidates.length} candidatos...`);
          try {
            const matchRes = await fetch("/api/youtube/match-frame", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                frameBase64: ld.rawFrameBase64,
                videos: unmatchedCandidates
              })
            });

            if (matchRes.ok) {
              const matchData = await matchRes.json();
              if (matchData.success && matchData.matchedIndex !== null) {
                const bestCandidate = data.videos.find(v => v.index === matchData.matchedIndex);
                if (bestCandidate) {
                  console.log(`[handleAnalyzeFile] Coincidencia visual exitosa! Vídeo local ${ld.filename || ld.id} coincide con index ${matchData.matchedIndex} ("${bestCandidate.title}")`);
                  matchedMap.set(bestCandidate.index, ld);
                  alreadyMatchedEditorIds.add(ld.id);
                }
              }
            }
          } catch (err) {
            console.warn(`[handleAnalyzeFile] Fallo en análisis visual para ${ld.filename || ld.id}:`, err.message);
          }
        }
      }

      // 4. Crear mapeo de parsedVideos de la escaleta (INCLUYENDO los no vinculados para permitir mapeo manual)
      const mapped = [];
      const matchedResults = [];

      for (const v of data.videos) {
        const matchedVideo = matchedMap.get(v.index) || null;

        const detected = detectProgramAndPlaylist(
          v.title || "", v.description || "", matchedVideo ? (matchedVideo.filename || matchedVideo.fileName || "") : "", v.programName || ""
        );

        let finalTitle = (v.title || "").trim();
        if (detected.logoName && detected.logoName !== "none") {
          const progClean = detected.logoName.replace(/\.[^/.]+$/, "").replace(/_/g, " ").toUpperCase().trim();
          const suffix = `| ${progClean}`;
          if (!finalTitle.toUpperCase().endsWith(suffix.toUpperCase())) {
            finalTitle = `${finalTitle} | ${progClean}`;
          }
        }

        const finalDesc = updateDescriptionUrl(v.description || "", detected.logoName);

        let finalThumbnailText = v.thumbnailText || "";
        if (finalThumbnailText) {
          finalThumbnailText = ensureThreeToFiveWords(finalThumbnailText, finalTitle);
        }

        const item = {
          index: v.index,
          title: finalTitle,
          description: finalDesc,
          thumbnailText: finalThumbnailText,
          isAutoThumbnailEnabled: true,
          selectedProgramLogo: detected.logoName,
          customBgBase64: null,
          generatedThumbnailBase64: null,
          matchedVideoId: matchedVideo ? (matchedVideo.youtubeId || matchedVideo.id) : "",
          isScheduled: false,
          scheduledAt: "",
          playlistId: detected.playlistId || "",
          isSyncing: false,
          isSynced: false,
          syncError: null
        };

        // Generar miniatura automática en segundo plano si hay video vinculado
        if (matchedVideo) {
          generateSingleAutoThumbnail(
            item.thumbnailText,
            matchedVideo,
            item.customBgBase64,
            item.selectedProgramLogo
          ).then(thumbBase64 => {
            setParsedVideos(latest => {
              const latestList = [...latest];
              const targetIdx = latestList.findIndex(x => x.index === v.index);
              if (targetIdx !== -1) {
                latestList[targetIdx].generatedThumbnailBase64 = thumbBase64 || "";
              }
              return latestList;
            });
          });
        }

        mapped.push(item);

        if (matchedVideo) {
          try {
            let finalThumbnailBase64 = null;
            if (item.thumbnailText && detected.logoName !== "none") {
              try {
                finalThumbnailBase64 = await generateSingleAutoThumbnail(
                  item.thumbnailText,
                  matchedVideo,
                  null,
                  detected.logoName
                );
              } catch (thumbErr) {
                console.error("[handleAnalyzeFile] Error al generar miniatura automática en mapeo:", thumbErr);
              }
            }

            // Generar emoji si tiene logotipo
            let finalTitleWithEmoji = item.title;
            if (detected.logoName && detected.logoName !== "none") {
              try {
                const emoji = await fetchEmojiForTitle(item.title, item.description || "");
                if (emoji) {
                  finalTitleWithEmoji = updateTitleSuffix(item.title, detected.logoName, emoji);
                }
              } catch (emojiErr) {
                console.warn("[handleAnalyzeFile] Error al generar emoji para el título:", emojiErr);
              }
            }

            const existingDbVid = dbVideos.find(dbv => dbv.youtubeId === matchedVideo.id || dbv.id === matchedVideo.id);
            if (existingDbVid) {
              const patchRes = await fetch(`/api/videos?id=${existingDbVid.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: finalTitleWithEmoji,
                  description: item.description,
                  playlistId: detected.playlistId || null,
                  thumbnailBase64: finalThumbnailBase64 || undefined,
                  status: "EDITING"
                })
              });
              if (patchRes.ok) {
                matchedResults.push({ index: v.index, success: true });
              } else {
                console.error(`[handleAnalyzeFile] Fallo al actualizar video en BD:`, await patchRes.text());
              }
            } else {
              // Si no existe localmente en la base de datos (p.ej. subido directo a YouTube), lo registramos automáticamente
              const postRes = await fetch(`/api/videos`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: finalTitleWithEmoji,
                  description: item.description,
                  filename: matchedVideo.fileName || matchedVideo.title || "Vídeo de YouTube",
                  filePath: "YOUTUBE_UPLOAD",
                  youtubeId: matchedVideo.id,
                  status: "EDITING",
                  playlistId: detected.playlistId || null
                })
              });
              if (postRes.ok) {
                const postData = await postRes.json();
                if (finalThumbnailBase64 && postData.video?.id) {
                  await fetch(`/api/videos?id=${postData.video.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ thumbnailBase64: finalThumbnailBase64 })
                  });
                }
                // Actualizar la referencia de ID para que el botón Editar borrador use el UUID local
                item.matchedVideoId = postData.video?.id || matchedVideo.id;
                matchedResults.push({ index: v.index, success: true });
              } else {
                console.error(`[handleAnalyzeFile] Fallo al crear registro para vídeo de YouTube en BD:`, await postRes.text());
              }
            }
          } catch (dbErr) {
            console.error(`[handleAnalyzeFile] Error al guardar vinculación en base de datos:`, dbErr);
          }
        } else {
          // Si no está vinculado automáticamente
          try {
            // Generar emoji si tiene logotipo
            let finalTitleWithEmoji = item.title;
            if (detected.logoName && detected.logoName !== "none") {
              try {
                const emoji = await fetchEmojiForTitle(item.title, item.description || "");
                if (emoji) {
                  finalTitleWithEmoji = updateTitleSuffix(item.title, detected.logoName, emoji);
                }
              } catch (emojiErr) {
                console.warn("[handleAnalyzeFile] Error al generar emoji para el título:", emojiErr);
              }
            }

            const postRes = await fetch(`/api/videos`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: finalTitleWithEmoji,
                description: item.description,
                filename: `PDF Parsed: ${v.title || "Sin título"}`,
                filePath: "PDF_PARSED",
                status: "EDITING",
                playlistId: detected.playlistId || null,
                youtubeId: null
              })
            });
            if (postRes.ok) {
              matchedResults.push({ index: v.index, success: false });
            } else {
              console.error(`[handleAnalyzeFile] Fallo al crear registro para vídeo sin emparejar en BD:`, await postRes.text());
            }
          } catch (dbErr) {
            console.error(`[handleAnalyzeFile] Error al guardar vídeo sin emparejar en base de datos:`, dbErr);
          }
        }
      }

      setParsedVideos([]); // Limpiar la cola temporal
      setSelectedYoutubeVideo(null); // Cerrar editor individual

      clearInterval(progressInterval);
      setAnalyzeProgress(100);

      // Recargar cola de videos locales
      await fetchScheduledUpdates();

      // Esperar brevemente para mostrar el 100%
      await new Promise(r => setTimeout(r, 400));
      alert(`¡Análisis y mapeo completado! Se detectaron ${data.videos.length} vídeos en el PDF y se guardaron directamente en la cola de borradores (vinculados automáticamente: ${matchedResults.filter(r => r.success).length}).`);
    } catch (err) {
      clearInterval(progressInterval);
      alert("Error al procesar el archivo: " + err.message);
    } finally {
      clearInterval(progressInterval);
      setIsAnalyzingFile(false);
    }
  };

  // Buscar vídeos en YouTube (incluyendo públicos) desde una tarjeta de la cola de borradores
  const handleCardVideoSearch = async (cardId, query) => {
    setCardSearchQueries(prev => ({ ...prev, [cardId]: query }));
    if (!query || query.trim().length < 2) {
      setCardSearchResults(prev => ({ ...prev, [cardId]: [] }));
      return;
    }
    setCardSearchLoading(prev => ({ ...prev, [cardId]: true }));
    try {
      const res = await fetch(`/api/youtube/videos?q=${encodeURIComponent(query)}&includePublic=true`);
      if (res.ok) {
        const data = await res.json();
        setCardSearchResults(prev => ({ ...prev, [cardId]: data }));
      } else {
        setCardSearchResults(prev => ({ ...prev, [cardId]: [] }));
      }
    } catch (err) {
      console.error("[handleCardVideoSearch] Error:", err);
      setCardSearchResults(prev => ({ ...prev, [cardId]: [] }));
    } finally {
      setCardSearchLoading(prev => ({ ...prev, [cardId]: false }));
    }
  };

  // Vincular borrador local a vídeo de YouTube
  const handleLinkCardToYoutube = async (cardDbId, youtubeVideoId, ytVideoTitle) => {
    try {
      // Buscar el borrador local del PDF en el estado
      const pdfCard = dbVideos.find(v => v.id === cardDbId);
      if (!pdfCard) {
        alert("No se encontró el borrador del PDF en la base de datos.");
        return;
      }

      // Buscar si ya existe un registro en la base de datos para este vídeo de YouTube (ej. subido por el subidor)
      const existingYtVid = dbVideos.find(v => v.youtubeId === youtubeVideoId && v.id !== cardDbId);

      // Detectar programa y playlist a partir de los datos del PDF
      const detected = detectProgramAndPlaylist(
        pdfCard.title || "",
        pdfCard.description || "",
        pdfCard.filename || ""
      );

      // Generar miniatura preliminar con el fondo real de YouTube
      let finalThumbnailBase64 = null;
      if (detected.logoName !== "none") {
        try {
          const cleanTitle = (pdfCard.title || "").replace(/\|.*$/, "").trim();
          let seoPhrase = "";

          // Intentar obtener la frase SEO desde Gemini
          try {
            const seoRes = await fetch("/api/youtube/generate-seo-phrase", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: cleanTitle, description: pdfCard.description })
            });
            if (seoRes.ok) {
              const seoData = await seoRes.json();
              seoPhrase = seoData.thumbnailText;
            }
          } catch (e) {
            console.warn("Fallo al generar frase SEO por API:", e);
          }

          if (!seoPhrase) {
            seoPhrase = ensureThreeToFiveWords("", cleanTitle);
          }

          // Generar la miniatura usando el objeto que contiene el youtubeId real para cargar el fotograma de YouTube
          finalThumbnailBase64 = await generateSingleAutoThumbnail(
            seoPhrase,
            existingYtVid || { id: youtubeVideoId, youtubeId: youtubeVideoId },
            null,
            detected.logoName
          );
        } catch (thumbErr) {
          console.error("Error al generar miniatura en vinculación manual desde buscador:", thumbErr);
        }
      }

      if (existingYtVid) {
        // CASO A: Ya existe un registro para este vídeo de YouTube en la BD local.
        // Actualizamos dicho registro con los metadatos correctos del PDF y la miniatura generada.
        const updateRes = await fetch(`/api/videos?id=${existingYtVid.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: pdfCard.title,
            description: pdfCard.description,
            playlistId: pdfCard.playlistId || detected.playlistId || null,
            thumbnailBase64: finalThumbnailBase64 || undefined,
            status: "EDITING"
          })
        });

        if (updateRes.ok) {
          // Eliminamos el registro temporal del PDF para evitar duplicados en la cola
          await fetch(`/api/videos?id=${pdfCard.id}&onlyLocal=true`, {
            method: "DELETE"
          });
        } else {
          const errData = await updateRes.json();
          alert(`Error al actualizar metadatos del vídeo: ${errData.error || "error desconocido"}`);
          return;
        }
      } else {
        // CASO B: No existe registro para este vídeo de YouTube todavía.
        // Simplemente enlazamos el registro del PDF a este youtubeId y guardamos la miniatura.
        const updateRes = await fetch(`/api/videos?id=${pdfCard.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            youtubeId: youtubeVideoId,
            thumbnailBase64: finalThumbnailBase64 || undefined,
            status: "EDITING"
          })
        });

        if (!updateRes.ok) {
          const errData = await updateRes.json();
          alert(`Error al vincular: ${errData.error || "error desconocido"}`);
          return;
        }
      }

      // Limpiar estados de búsqueda
      setCardSearchQueries(prev => { const next = { ...prev }; delete next[cardDbId]; return next; });
      setCardSearchResults(prev => { const next = { ...prev }; delete next[cardDbId]; return next; });
      setShowSearchForCard(prev => { const next = { ...prev }; delete next[cardDbId]; return next; });
      
      await fetchScheduledUpdates();
      fetchTasks();
      alert(`Borrador vinculado con éxito y metadatos del PDF copiados.`);
    } catch (err) {
      console.error(err);
      alert("Error de red al vincular el vídeo.");
    }
  };

  // Desvincular borrador local del vídeo de YouTube
  const handleUnlinkCardFromYoutube = async (cardDbId) => {
    if (!confirm("¿Estás seguro de que deseas desvincular este borrador del vídeo de YouTube?")) return;
    try {
      const res = await fetch(`/api/videos?id=${cardDbId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeId: null
        })
      });

      if (res.ok) {
        await fetchScheduledUpdates();
      } else {
        alert("Error al desvincular.");
      }
    } catch (err) {
      console.error(err);
      alert("Error de red al desvincular.");
    }
  };

  // Vincular o desvincular un vídeo de YouTube a un ítem detectado del PDF en tiempo real
  const handleLinkVideoToPdfItem = async (itemIndex, youtubeVideoId) => {
    const pdfItem = parsedVideos.find(v => v.index === itemIndex);
    if (!pdfItem) return;

    // Caso A: Desvincular el vídeo
    if (!youtubeVideoId) {
      const prevYtId = pdfItem.matchedVideoId;
      if (prevYtId) {
        const dbVid = dbVideos.find(v => v.youtubeId === prevYtId || v.id === prevYtId);
        if (dbVid) {
          try {
            await fetch(`/api/videos?id=${dbVid.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "LOCAL_DRAFT" })
            });
            await fetchScheduledUpdates();
          } catch (err) {
            console.error("Error al restablecer estado del vídeo desvinculado:", err);
          }
        }
      }
      setParsedVideos(prev => prev.map(v => v.index === itemIndex ? { ...v, matchedVideoId: "" } : v));
      return;
    }

    // Caso B: Vincular a un vídeo de YouTube
    let dbVid = dbVideos.find(v => v.youtubeId === youtubeVideoId || v.id === youtubeVideoId);
    if (!dbVid) {
      // Buscar en los vídeos importados de YouTube
      const ytVideo = privateVideos.find(pv => pv.id === youtubeVideoId);
      if (!ytVideo) {
        alert("No se encontró el registro de vídeo local correspondiente ni en YouTube.");
        return;
      }
      try {
        const postRes = await fetch(`/api/videos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: pdfItem.title,
            description: pdfItem.description,
            filename: ytVideo.fileName || ytVideo.title || "Vídeo de YouTube",
            filePath: "YOUTUBE_UPLOAD",
            youtubeId: ytVideo.id,
            status: "EDITING",
            playlistId: pdfItem.playlistId || null
          })
        });
        if (postRes.ok) {
          const postData = await postRes.json();
          dbVid = postData.video;
          // Asignar el ID local generado temporalmente para el resto de la vinculación
          youtubeVideoId = dbVid.id;
        } else {
          alert("Error al registrar el vídeo de YouTube en la base de datos.");
          return;
        }
      } catch (postErr) {
        console.error("Error creating video record:", postErr);
        alert("Error de red al registrar el vídeo.");
        return;
      }
    }

    // Generar miniatura preliminar
    let finalThumbnailBase64 = null;
    if (pdfItem.thumbnailText && pdfItem.selectedProgramLogo !== "none") {
      try {
        finalThumbnailBase64 = await generateSingleAutoThumbnail(
          pdfItem.thumbnailText,
          dbVid,
          null,
          pdfItem.selectedProgramLogo
        );
      } catch (thumbErr) {
        console.error("Error al pre-generar miniatura en vinculación manual:", thumbErr);
      }
    }

    // Generar emoji si tiene logotipo
    let finalTitleWithEmoji = pdfItem.title;
    if (pdfItem.selectedProgramLogo && pdfItem.selectedProgramLogo !== "none") {
      try {
        const emoji = await fetchEmojiForTitle(pdfItem.title, pdfItem.description || "");
        if (emoji) {
          finalTitleWithEmoji = updateTitleSuffix(pdfItem.title, pdfItem.selectedProgramLogo, emoji);
        }
      } catch (emojiErr) {
        console.warn("[handleLinkVideoToPdfItem] Error al generar emoji para el título:", emojiErr);
      }
    }

    // Actualizar base de datos
    try {
      const res = await fetch(`/api/videos?id=${dbVid.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: finalTitleWithEmoji,
          description: pdfItem.description,
          playlistId: pdfItem.playlistId || null,
          thumbnailBase64: finalThumbnailBase64 || undefined,
          status: "EDITING"
        })
      });

      if (res.ok) {
        setParsedVideos(prev => prev.map(v => 
          v.index === itemIndex 
            ? { 
                ...v, 
                matchedVideoId: youtubeVideoId, 
                generatedThumbnailBase64: finalThumbnailBase64 || v.generatedThumbnailBase64 
              } 
            : v
        ));
        await fetchScheduledUpdates();
      } else {
        alert("Error al actualizar la información del vídeo en la base de datos.");
      }
    } catch (err) {
      console.error("Error de red al vincular el vídeo:", err);
      alert("Error de red al conectar con el servidor.");
    }
  };

  // Generar frase SEO para un video en lote con IA
  const handleGenerateSeoPhraseForIndex = async (index, title, description) => {
    if (!title) {
      alert("Introduce un título primero para generar la frase SEO.");
      return;
    }
    setGeneratingSeoIndex(prev => ({ ...prev, [index]: true }));
    try {
      const res = await fetch("/api/youtube/generate-seo-phrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.thumbnailText) {
          await regenerateThumbnailForIndex(index, { thumbnailText: data.thumbnailText });
        }
      } else {
        alert("Error al generar la frase SEO.");
      }
    } catch (err) {
      console.error(err);
      alert("Error de red al conectar con Gemini.");
    } finally {
      setGeneratingSeoIndex(prev => ({ ...prev, [index]: false }));
    }
  };

  // Sincronizar un único item de lote directamente a YouTube
  const handleSyncSingleBatchItem = async (item) => {
    if (!item.matchedVideoId) {
      alert("Por favor, vincula este vídeo a uno de YouTube primero.");
      return;
    }
    
    // Validar frase SEO
    if (item.isAutoThumbnailEnabled) {
      const count = getWordCount(item.thumbnailText);
      if (count < 3 || count > 5) {
        alert(`La frase SEO para el vídeo ${item.index} debe tener entre 3 y 5 palabras. Tiene ${count}.`);
        return;
      }
    }

    if (!confirm(`¿Sincronizar el vídeo ${item.index} ("${item.title}") en YouTube?`)) {
      return;
    }

    // Marcar como sincronizando
    setParsedVideos(prev => prev.map(v => v.index === item.index ? { ...v, isSyncing: true, syncError: null } : v));

    try {
      const res = await fetch("/api/youtube/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeVideoId: item.matchedVideoId,
          title: item.title,
          description: item.description,
          thumbnail: item.isAutoThumbnailEnabled ? item.generatedThumbnailBase64 : null,
          scheduledAt: item.scheduledAt ? toUTCISOString(item.scheduledAt) : null,
          playlistId: item.playlistId || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Fallo al actualizar el vídeo en YouTube");
      }

      const resData = await res.json();

      setParsedVideos(prev => prev.map(v => {
        if (v.index === item.index) {
          return {
            ...v,
            isSyncing: false,
            isSynced: true,
            syncError: resData.thumbnailError ? `Sincronizado sin miniatura: ${resData.thumbnailError}` : null
          };
        }
        return v;
      }));

      alert("¡Vídeo sincronizado con éxito en YouTube!");
      fetchTasks();
      fetchScheduledUpdates();
    } catch (err) {
      console.error(err);
      setParsedVideos(prev => prev.map(v => v.index === item.index ? { ...v, isSyncing: false, syncError: err.message } : v));
      alert("Error al sincronizar el vídeo: " + err.message);
    }
  };

  // Sincronizar todos los videos mapeados en lote
  const handleSyncAllVideos = async () => {
    const matchedItems = parsedVideos.filter(v => v.matchedVideoId);
    if (matchedItems.length === 0) {
      alert("No hay ningún video mapeado con YouTube para sincronizar.");
      return;
    }

    // Validar frase SEO de 3 a 5 palabras para miniaturas automáticas en lote
    const invalidItems = matchedItems.filter(item => {
      if (!item.isAutoThumbnailEnabled) return false;
      const count = getWordCount(item.thumbnailText);
      return count < 3 || count > 5;
    });

    if (invalidItems.length > 0) {
      alert(`No se puede sincronizar en lote porque los siguientes vídeos tienen una frase SEO que no tiene entre 3 y 5 palabras:\n\n` +
        invalidItems.map(item => `Vídeo ${item.index}: "${item.title}" (${getWordCount(item.thumbnailText)} palabras)`).join("\n") +
        `\n\nPor favor, corrígelos antes de sincronizar.`);
      return;
    }

    if (!confirm(`Se van a sincronizar y actualizar ${matchedItems.length} videos en YouTube. ¿Deseas continuar?`)) {
      return;
    }

    setIsSyncingBatch(true);
    setSyncProgress({ current: 0, total: matchedItems.length, status: "Iniciando sincronización..." });

    let currentCount = 0;

    for (let i = 0; i < parsedVideos.length; i++) {
      const item = parsedVideos[i];
      if (!item.matchedVideoId) continue;

      currentCount++;
      setSyncProgress({
        current: currentCount,
        total: matchedItems.length,
        status: `Sincronizando vídeo ${item.index}: "${item.title}"...`
      });

      // Marcar item como sincronizando
      setParsedVideos(prev => {
        const list = [...prev];
        list[i].isSyncing = true;
        list[i].syncError = null;
        return list;
      });

      try {
        const res = await fetch("/api/youtube/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            youtubeVideoId: item.matchedVideoId,
            title: item.title,
            description: item.description,
            thumbnail: item.isAutoThumbnailEnabled ? item.generatedThumbnailBase64 : null,
            scheduledAt: item.scheduledAt ? toUTCISOString(item.scheduledAt) : null,
            playlistId: item.playlistId || null,
          }),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Fallo en la llamada de sincronización");
        }

        const resData = await res.json();

        // Marcar item como completado
        setParsedVideos(prev => {
          const list = [...prev];
          const targetIdx = list.findIndex(x => x.index === item.index);
          if (targetIdx !== -1) {
            list[targetIdx].isSyncing = false;
            list[targetIdx].isSynced = true;
            if (resData.thumbnailError) {
              list[targetIdx].syncError = `Sincronizado sin miniatura: ${resData.thumbnailError}`;
            }
          }
          return list;
        });

      } catch (err) {
        console.error(`Error syncing video index ${item.index}:`, err);
        setParsedVideos(prev => {
          const list = [...prev];
          const targetIdx = list.findIndex(x => x.index === item.index);
          if (targetIdx !== -1) {
            list[targetIdx].isSyncing = false;
            list[targetIdx].syncError = err.message;
          }
          return list;
        });
      }
    }

    setSyncProgress(prev => ({ ...prev, status: "Sincronización finalizada." }));
    setIsSyncingBatch(false);
    fetchTasks();
    fetchScheduledUpdates();
    alert("¡Sincronización en lote finalizada!");
  };

  // Programar todos los videos mapeados en lote con la misma fecha/hora
  const handleScheduleAllVideos = async () => {
    const matchedItems = parsedVideos.filter(v => v.matchedVideoId);
    if (matchedItems.length === 0) {
      alert("No hay ningún video mapeado con YouTube para programar.");
      return;
    }
    if (!batchScheduleDate) {
      alert("Selecciona una fecha y hora antes de programar.");
      return;
    }

    // Validar frase SEO de 3 a 5 palabras para miniaturas automáticas en lote
    const invalidItems = matchedItems.filter(item => {
      if (!item.isAutoThumbnailEnabled) return false;
      const count = getWordCount(item.thumbnailText);
      return count < 3 || count > 5;
    });

    if (invalidItems.length > 0) {
      alert(`No se puede programar en lote porque los siguientes vídeos tienen una frase SEO que no tiene entre 3 y 5 palabras:\n\n` +
        invalidItems.map(item => `Vídeo ${item.index}: "${item.title}" (${getWordCount(item.thumbnailText)} palabras)`).join("\n") +
        `\n\nPor favor, corrígelos antes de programar.`);
      return;
    }

    if (!confirm(`Se va a programar la sincronización de ${matchedItems.length} videos para el ${batchScheduleDate}. ¿Deseas continuar?`)) {
      return;
    }

    setIsSyncingBatch(true);
    setSyncProgress({ current: 0, total: matchedItems.length, status: "Programando sincronizaciones..." });

    let currentCount = 0;
    for (let i = 0; i < parsedVideos.length; i++) {
      const item = parsedVideos[i];
      if (!item.matchedVideoId) continue;

      currentCount++;
      setSyncProgress({
        current: currentCount,
        total: matchedItems.length,
        status: `Programando vídeo ${item.index}: "${item.title}"...`
      });

      setParsedVideos(prev => {
        const list = [...prev];
        list[i].isSyncing = true;
        list[i].syncError = null;
        return list;
      });

      try {
        const res = await fetch("/api/youtube/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            youtubeVideoId: item.matchedVideoId,
            title: item.title,
            description: item.description,
            thumbnail: item.isAutoThumbnailEnabled ? item.generatedThumbnailBase64 : null,
            scheduledAt: toUTCISOString(batchScheduleDate),
            playlistId: item.playlistId || null,
          }),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Fallo al programar");
        }

        setParsedVideos(prev => {
          const list = [...prev];
          const targetIdx = list.findIndex(x => x.index === item.index);
          if (targetIdx !== -1) {
            list[targetIdx].isSyncing = false;
            list[targetIdx].isSynced = true;
            list[targetIdx].isScheduled = true;
            list[targetIdx].scheduledAt = batchScheduleDate;
          }
          return list;
        });
      } catch (err) {
        console.error(`Error programando video index ${item.index}:`, err);
        setParsedVideos(prev => {
          const list = [...prev];
          const targetIdx = list.findIndex(x => x.index === item.index);
          if (targetIdx !== -1) {
            list[targetIdx].isSyncing = false;
            list[targetIdx].syncError = err.message;
          }
          return list;
        });
      }
    }

    setSyncProgress(prev => ({ ...prev, status: "Programación finalizada." }));
    setIsSyncingBatch(false);
    fetchTasks();
    fetchScheduledUpdates();
    setBatchScheduleEnabled(false);
    alert(`¡${matchedItems.length} videos programados para sincronizar el ${batchScheduleDate}!`);
  };

  // Guardar cambios en YouTube o Localmente y marcar tarea como completada
  const handleSaveVideo = async (e, privacyStatus = "private") => {
    if (e) e.preventDefault();
    if (!selectedYoutubeVideo) return;

    if (isAutoThumbnailEnabled) {
      const cleanText = thumbnailText.replace(/[\/\-\"\']/g, " ").replace(/\s+/g, " ").trim();
      const wordCount = cleanText ? cleanText.split(/\s+/).length : 0;
      if (wordCount < 3 || wordCount > 5) {
        alert(`La frase SEO de la miniatura debe tener entre 3 y 5 palabras. Actualmente tiene ${wordCount}. Por favor, corrígela.`);
        return;
      }
    }

    setUpdatingYoutubeVideo(true);
    try {
      if (selectedYoutubeVideo.isBatchItem) {
        // Sincronizar en YouTube directamente
        setSimpleUploadProgress(10);
        setSimpleUploadStatus("Sincronizando metadatos del lote...");
        
        const ytId = selectedYoutubeVideo.youtubeId; // el ID de YouTube vinculado
        if (!ytId) {
          throw new Error("Este vídeo no está vinculado a ningún vídeo de YouTube. Por favor vincúlalo antes de sincronizar.");
        }
        
        const res = await fetch("/api/youtube/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            youtubeVideoId: ytId,
            title: updateForm.title,
            description: updateForm.description,
            tags: updateForm.tags,
            thumbnail: isAutoThumbnailEnabled ? newThumbnailBase64 : null,
            scheduledAt: updateForm.isScheduled ? toUTCISOString(updateForm.scheduledAt) : null,
            playlistId: updateForm.playlistId || null,
            privacyStatus: privacyStatus
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Fallo al guardar los cambios en YouTube");
        }

        const responseData = await res.json();

        // Marcar como sincronizado en la lista del PDF
        setParsedVideos(prev => prev.map(v => {
          if (v.index === selectedYoutubeVideo.batchIndex) {
            return {
              ...v,
              title: updateForm.title,
              description: updateForm.description,
              tags: updateForm.tags,
              playlistId: updateForm.playlistId,
              isAutoThumbnailEnabled: isAutoThumbnailEnabled,
              thumbnailText: thumbnailText,
              generatedThumbnailBase64: newThumbnailBase64 || v.generatedThumbnailBase64,
              customBgBase64: customBgBase64 || v.customBgBase64,
              isScheduled: updateForm.isScheduled,
              scheduledAt: updateForm.scheduledAt,
              isSynced: true,
              syncError: responseData.thumbnailError ? `Sincronizado sin miniatura: ${responseData.thumbnailError}` : null
            };
          }
          return v;
        }));

        setSimpleUploadProgress(100);
        setSimpleUploadStatus("¡Sincronización completada con éxito!");
        
        if (responseData.scheduled) {
          alert("¡Sincronización programada con éxito en YouTube!");
        } else if (responseData.thumbnailError) {
          alert(`¡Video sincronizado con éxito en YouTube, pero la miniatura no se pudo subir!\n\nDetalle: ${responseData.thumbnailError}`);
        } else {
          alert("¡Video sincronizado y actualizado en YouTube con éxito!");
        }
        handleCloseEditor();
        return;
      }

      const isLocal = !!selectedYoutubeVideo.isLocal;

      if (isLocal) {
        if (selectedYoutubeVideo.filePath === "PDF_PARSED") {
          alert("Este borrador proviene de un PDF y debe vincularse a un vídeo de YouTube (mediante el buscador en su tarjeta) antes de poder guardarlo o sincronizarlo.");
          setUpdatingYoutubeVideo(false);
          return;
        }
        setSimpleUploadProgress(0);
        setSimpleUploadStatus("Descargando vídeo de la nube...");

        // 1. Guardar primero los metadatos y la miniatura localmente en nuestra base de datos
        const patchRes = await fetch(`/api/videos?id=${selectedYoutubeVideo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: updateForm.title,
            description: updateForm.description,
            tags: updateForm.tags,
            playlistId: updateForm.playlistId || null,
            thumbnailBase64: newThumbnailBase64 || null,
            rawFrameBase64: (customBgBase64 && customBgBase64.startsWith("data:")) ? customBgBase64 : undefined,
            scheduledAt: updateForm.isScheduled ? toUTCISOString(updateForm.scheduledAt) : null,
            status: updateForm.isScheduled ? 'SCHEDULED' : 'UPLOADING'
          })
        });

        if (!patchRes.ok) {
          const errData = await patchRes.json();
          throw new Error(errData.error || "Fallo al guardar metadatos locales");
        }

        const queuedUploadItem = {
          ...selectedYoutubeVideo,
          title: updateForm.title,
          description: updateForm.description,
          tags: updateForm.tags,
          playlistId: updateForm.playlistId || null,
          scheduledAt: updateForm.isScheduled ? toUTCISOString(updateForm.scheduledAt) : null,
          status: updateForm.isScheduled ? "SCHEDULED" : "UPLOADING",
          uploadProgress: 0
        };
        setScheduledUpdates(prev => {
          const withoutCurrent = prev.filter(item => item.id !== selectedYoutubeVideo.id);
          return [queuedUploadItem, ...withoutCurrent];
        });

        // 2. Descargar el archivo de vídeo (desde Supabase si es URL, o desde la API local si está en el disco del servidor)
        const fetchUrl = selectedYoutubeVideo.filePath.startsWith("http")
          ? selectedYoutubeVideo.filePath
          : `/api/videos/stream?id=${selectedYoutubeVideo.id}`;
        
        const blobRes = await fetch(fetchUrl);
        if (!blobRes.ok) {
          throw new Error("No se pudo descargar el vídeo del servidor. Es posible que el archivo haya sido eliminado.");
        }
        const videoBlob = await blobRes.blob();

        // 3. Iniciar la sesión de subida en YouTube
        setSimpleUploadStatus("Iniciando sesión de subida en YouTube...");
        const initiateRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId: selectedYoutubeVideo.id,
            title: updateForm.title,
            description: updateForm.description,
            tags: updateForm.tags,
            fileName: selectedYoutubeVideo.fileName || selectedYoutubeVideo.filename || "video.mp4",
            fileSize: videoBlob.size,
            fileType: videoBlob.type || "video/mp4",
            playlistId: updateForm.playlistId || null,
            extractedFrames: capturedFrames || [],
            scheduledAt: updateForm.isScheduled ? toUTCISOString(updateForm.scheduledAt) : null
          })
        });

        if (!initiateRes.ok) {
          const errData = await initiateRes.json();
          throw new Error(errData.error || "Fallo al iniciar sesión de subida en YouTube");
        }

        const { uploadUrl } = await initiateRes.json();
        setSimpleUploadStatus("Subiendo archivo a YouTube...");

        // 4. Subir directamente el Blob a YouTube (PUT)
        let lastPersistedProgress = -1;
        let lastPersistedAt = 0;
        const persistUploadProgress = (percent, force = false) => {
          const progress = Math.max(0, Math.min(100, Math.round(percent)));
          setScheduledUpdates(prev => prev.map(item =>
            item.id === selectedYoutubeVideo.id
              ? { ...item, status: "UPLOADING", uploadProgress: progress }
              : item
          ));

          const now = Date.now();
          if (!force && progress < 100 && progress - lastPersistedProgress < 5 && now - lastPersistedAt < 1000) {
            return;
          }
          lastPersistedProgress = progress;
          lastPersistedAt = now;
          fetch(`/api/videos?id=${selectedYoutubeVideo.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "UPLOADING", uploadProgress: progress })
          }).catch(progressErr => {
            console.warn("[Editor Upload] Failed to persist upload progress:", progressErr);
          });
        };

        const youtubeId = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl, true);
          xhr.setRequestHeader("Content-Type", videoBlob.type || "video/mp4");

          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable) {
              const percent = Math.round((evt.loaded / evt.total) * 100);
              setSimpleUploadProgress(percent);
              setSimpleUploadStatus(`Enviando a YouTube: ${percent}%...`);
              persistUploadProgress(percent);
            }
          };

          xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 201) {
              try {
                const responseJson = JSON.parse(xhr.responseText);
                if (responseJson && responseJson.id) {
                  persistUploadProgress(100, true);
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
            reject(new Error("Error de conexión al subir a YouTube."));
          };

          xhr.send(videoBlob);
        });

        // 5. Completar subida en la base de datos
        setSimpleUploadStatus("Finalizando registro en la base de datos...");
        const completeRes = await fetch("/api/upload?action=complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId: selectedYoutubeVideo.id,
            youtubeId
          })
        });

        if (!completeRes.ok) {
          const errData = await completeRes.json();
          throw new Error(errData.error || "Fallo al completar subida en base de datos");
        }

        // 6. Aplicar metadatos (título, descripción, tags, playlist, miniatura) y programar/publicar en YouTube usando el endpoint existente
        setSimpleUploadStatus("Sincronizando metadatos y portada en YouTube...");
        const updateRes = await fetch("/api/youtube/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            youtubeVideoId: youtubeId,
            title: updateForm.title,
            description: updateForm.description,
            tags: updateForm.tags,
            thumbnail: isAutoThumbnailEnabled ? newThumbnailBase64 : null,
            scheduledAt: updateForm.isScheduled ? toUTCISOString(updateForm.scheduledAt) : null,
            playlistId: updateForm.playlistId || null,
            privacyStatus: privacyStatus
          }),
        });

        if (!updateRes.ok) {
          const errData = await updateRes.json();
          throw new Error(errData.error || "Fallo al sincronizar metadatos y portada en YouTube");
        }

        const updateData = await updateRes.json();

        // 7. Actualizar el registro local a SCHEDULED o COMPLETED según corresponda
        const isScheduled = updateForm.isScheduled;
        const newStatus = isScheduled ? 'SCHEDULED' : 'COMPLETED';

        const dbRes = await fetch(`/api/videos?id=${selectedYoutubeVideo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: updateForm.title,
            description: updateForm.description,
            tags: updateForm.tags,
            playlistId: updateForm.playlistId || null,
            thumbnailBase64: newThumbnailBase64 || null,
            rawFrameBase64: (customBgBase64 && customBgBase64.startsWith("data:")) ? customBgBase64 : undefined,
            status: newStatus,
            privacyStatus: privacyStatus || 'private',
            scheduledAt: isScheduled ? toUTCISOString(updateForm.scheduledAt) : null
          })
        });

        if (!dbRes.ok) {
          console.warn("[Editor Upload] Failed to update local database video status after upload completed.");
        }

        // Nota: el archivo de Supabase NO se borra aquí.
        // Se conserva para que el editor pueda usar el slider de fotograma.
        // Se eliminará automáticamente cuando el editor publique el vídeo (handleSaveVideo).
        console.log("[Editor Upload] Supabase file preserved for editor frame selection slider.");

        if (updateData.scheduled) {
          setSimpleUploadStatus("¡Sincronización programada con éxito!");
          alert("¡El vídeo ha sido subido a YouTube y programado con éxito!");
        } else {
          setSimpleUploadStatus("¡Vídeo publicado con éxito!");
          alert("¡El vídeo ha sido subido y publicado con éxito en YouTube!");
        }
      } else {
        // Vídeo que ya está en YouTube: usar endpoint existente
        setSimpleUploadProgress(5);
        setSimpleUploadStatus("Preparando datos de sincronización...");

        let progressInterval;
        let t1, t2, t3;

        try {
          progressInterval = setInterval(() => {
            setSimpleUploadProgress(prev => {
              if (prev < 90) {
                return prev + Math.floor(Math.random() * 5) + 2; // Incrementos entre 2 y 6%
              }
              if (prev < 98) {
                return prev + 1;
              }
              return prev;
            });
          }, 300);

          t1 = setTimeout(() => setSimpleUploadStatus("Sincronizando metadatos (título, descripción, etiquetas)..."), 800);
          t2 = setTimeout(() => setSimpleUploadStatus("Subiendo miniatura con diseño de portada..."), 2200);
          t3 = setTimeout(() => setSimpleUploadStatus("Aplicando cambios en YouTube Studio..."), 4500);

          const ytId = selectedYoutubeVideo.youtubeId || selectedYoutubeVideo.id;
          const res = await fetch("/api/youtube/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              youtubeVideoId: ytId,
              title: updateForm.title,
              description: updateForm.description,
              tags: updateForm.tags,
              thumbnail: newThumbnailBase64,
              scheduledAt: updateForm.isScheduled ? toUTCISOString(updateForm.scheduledAt) : null,
              playlistId: updateForm.playlistId || null,
              privacyStatus: privacyStatus
            }),
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Fallo al guardar los cambios en YouTube");
          }

          const responseData = await res.json();

          // Si viene de la cola local de pendientes o está registrado en la base de datos local
          if (selectedYoutubeVideo.youtubeId || selectedYoutubeVideo.dbId) {
            const isScheduled = updateForm.isScheduled;
            const newStatus = isScheduled ? 'SCHEDULED' : 'COMPLETED';
            const videoDbId = selectedYoutubeVideo.dbId || selectedYoutubeVideo.id;

            const dbRes = await fetch(`/api/videos?id=${videoDbId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: updateForm.title,
                description: updateForm.description,
                tags: updateForm.tags,
                playlistId: updateForm.playlistId || null,
                thumbnailBase64: newThumbnailBase64 || null,
                rawFrameBase64: (customBgBase64 && customBgBase64.startsWith("data:")) ? customBgBase64 : undefined,
                status: newStatus,
                privacyStatus: privacyStatus || 'private', // ← guardar estado real
                scheduledAt: isScheduled ? toUTCISOString(updateForm.scheduledAt) : null
              })
            });

            if (!dbRes.ok) {
              console.warn("[Editor] Failed to update local database video status.");
            }
          }

          setSimpleUploadProgress(100);
          setSimpleUploadStatus("¡Sincronización completada con éxito!");

          if (responseData.scheduled) {
            alert("¡Sincronización programada con éxito!");
          } else {
            if (responseData.thumbnailError) {
              alert(`¡Video actualizado en YouTube con éxito, pero la miniatura no se pudo subir!\n\nDetalle: ${responseData.thumbnailError}`);
            } else {
              alert("¡Video sincronizado y actualizado en YouTube con éxito!");
            }
          }
        } finally {
          clearInterval(progressInterval);
          clearTimeout(t1);
          clearTimeout(t2);
          clearTimeout(t3);
        }
      }

      // Eliminar el archivo de Supabase si el vídeo lo tenía (filePath = URL de Supabase).
      // Se hace aquí, tras publicar, para que el editor haya podido usar el slider.
      const supabaseFilePath = selectedYoutubeVideo?.filePath;
      if (supabaseFilePath && supabaseFilePath.startsWith('https://') && supabaseFilePath.includes('/storage/v1/object/public/videos/')) {
        try {
          const urlParts = supabaseFilePath.split('/videos/');
          if (urlParts.length > 1) {
            const storagePath = urlParts[1];
            fetch("/api/upload/supabase/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: storagePath })
            }).then(res => {
              if (res.ok) console.log("[handleSaveVideo] Supabase file deleted after editor published.");
              else console.warn("[handleSaveVideo] Could not delete Supabase file after publish.");
            }).catch(err => console.warn("[handleSaveVideo] Supabase delete error:", err));
          }
        } catch (deleteErr) {
          console.warn("[handleSaveVideo] Error deleting Supabase file:", deleteErr);
        }
      }

      setSelectedYoutubeVideo(null);
      setOptimizationSuggestions(null);
      setYoutubeId("");
      try { setPdfFile(null); } catch (_) {}
      setDocumentFiles([]);
      handleResetThumbnailStates();
      fetchTasks();
      fetchScheduledUpdates();
    } catch (err) {
      alert("Error al guardar cambios: " + err.message);
    } finally {
      setUpdatingYoutubeVideo(false);
    }
  };

  // Compresión manual para miniatura de portada subida
  const handleNewThumbnailSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setNewThumbnailBase64(event.target.result);
        try {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = 1280;
            canvas.height = 720;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            const imgRatio = img.width / img.height;
            const targetRatio = 1280 / 720;
            let drawWidth, drawHeight, drawX, drawY;

            if (imgRatio > targetRatio) {
              drawHeight = img.height;
              drawWidth = img.height * targetRatio;
              drawX = (img.width - drawWidth) / 2;
              drawY = 0;
            } else {
              drawWidth = img.width;
              drawHeight = img.width / targetRatio;
              drawX = 0;
              drawY = (img.height - drawHeight) / 2;
            }
            ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight, 0, 0, 1280, 720);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
            setNewThumbnailBase64(dataUrl);
          };
          img.src = event.target.result;
        } catch (err) {
          console.error("Error al procesar miniatura subida:", err);
        }
      };
      reader.readAsDataURL(file);
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

  // Convierte un string de fecha/hora local (del DateTimePicker) a ISO UTC
  const toUTCISOString = (localDateTimeStr) => {
    if (!localDateTimeStr) return null;
    return new Date(localDateTimeStr).toISOString();
  };

  const toLocalDateTimeString = (date) => {
    if (!date) return "";
    const d = new Date(date);
    // Usar Europe/Madrid explícitamente para que el picker muestre hora española
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const get = (type) => parts.find(p => p.type === type)?.value || "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  };

  const combinedPendingTasks = useMemo(() => {
    // 1. Tareas de la base de datos
    const dbPending = tasks.filter(t => t.status === "PENDIENTE_SINCRONIZACION" || t.status === "PENDING" || t.status === "SCHEDULED");

    // 2. Videos locales del editor en lote que están mapeados y no sincronizados aún
    const localPending = parsedVideos
      .filter(v => v.matchedVideoId && !v.isSynced)
      .map(v => {
        const scheduledUpdate = scheduledUpdates.find(u => u.youtubeId === v.matchedVideoId);
        return {
          id: `local-${v.index}-${v.matchedVideoId}`,
          youtubeId: v.matchedVideoId,
          title: v.title,
          description: v.description,
          status: v.isScheduled || !!scheduledUpdate ? "SCHEDULED" : "PENDING",
          dueDate: v.scheduledAt ? new Date(v.scheduledAt) : (scheduledUpdate ? new Date(scheduledUpdate.scheduledAt) : null),
          isLocal: true,
          index: v.index
        };
      });

    // Evitar duplicados por youtubeId (si la tarea de la base de datos ya existe)
    const dbYoutubeIds = new Set(dbPending.map(t => t.youtubeId));
    const filteredLocal = localPending.filter(l => !dbYoutubeIds.has(l.youtubeId));

    return [...dbPending, ...filteredLocal];
  }, [tasks, parsedVideos, scheduledUpdates]);

  // Obtener borradores locales desde la base de datos
  const localDrafts = useMemo(() => {
    return dbVideos
      .filter(v => v.status === "LOCAL_DRAFT" || v.status === "EDITING" || v.status === "UPLOADING")
      .map(v => ({
        id: v.youtubeId || v.id,
        dbId: v.id,
        title: v.title,
        description: v.description,
        thumbnail: v.thumbnailBase64 || v.rawFrameBase64 || '',
        publishedAt: v.createdAt,
        tags: v.tags || '',
        privacyStatus: v.privacyStatus || 'private',
        fileName: v.filename || '',
        isLocalDraft: true,
        createdAt: v.createdAt,
        status: v.status,
        uploadProgress: v.uploadProgress || 0
      }));
  }, [dbVideos]);


  // Filtrar los borradores de YouTube para mostrar solo los que realmente están pendientes
  const pendingPrivateVideos = useMemo(() => {
    const completedOrScheduledIds = new Set([
      ...completedLocalVideos.map(v => v.youtubeId),
      ...scheduledUpdates.map(v => v.youtubeId),
      ...tasks.filter(t => t.status === "COMPLETED" || t.status === "SCHEDULED").map(t => t.youtubeId)
    ].filter(Boolean));

    // Obtener los títulos de los vídeos que se están subiendo actualmente
    const uploadingTitles = new Set(
      dbVideos
        .filter(v => v.status === "UPLOADING" && v.title)
        .map(v => v.title.toLowerCase().trim())
    );

    // Filtrar privateVideos para excluir borradores de YouTube cuyo título coincida con un vídeo subiéndose
    const filteredPrivateVideos = privateVideos.filter(video => {
      const vTitle = video.snippet?.title || video.title;
      if (!vTitle) return true;
      return !uploadingTitles.has(vTitle.toLowerCase().trim());
    });

    const mergedList = [...filteredPrivateVideos];
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
  }, [privateVideos, localDrafts, completedLocalVideos, scheduledUpdates, tasks, dbVideos]);

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

    const localItems = completedLocalVideos
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
    [...taskItems, ...localItems].forEach(item => {
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

  if (checkingAuth) {
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
        <p style={{ marginTop: "1rem", color: "#94a3b8", fontSize: "0.9rem" }}>Cargando portal...</p>
      </div>
    );
  }

  if (isAuthRequired && !isAuthenticated) {
    const handleGoogleLogin = () => {
      window.location.href = "/api/auth/app-login";
    };

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
          <div style={{
            fontSize: "3.5rem",
            marginBottom: "1rem",
            display: "inline-block",
            background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            filter: "drop-shadow(0 0 10px rgba(168, 85, 247, 0.3))"
          }}>
            🔒
          </div>

          <h2 style={{
            fontSize: "1.75rem",
            fontWeight: "800",
            letterSpacing: "-0.03em",
            marginBottom: "0.5rem",
            background: "linear-gradient(135deg, #ffffff 40%, #e2e8f0 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>
            Acceso Protegido
          </h2>

          <p style={{
            color: "#94a3b8",
            fontSize: "0.85rem",
            lineHeight: "1.5",
            marginBottom: "2rem"
          }}>
            Inicia sesión con tu cuenta de Google autorizada para poder acceder a la aplicación.
          </p>

          {authError && (
            <div style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              color: "#ef4444",
              fontSize: "0.8rem",
              padding: "0.75rem 1rem",
              borderRadius: "12px",
              textAlign: "left",
              marginBottom: "1.5rem"
            }}>
              ⚠️ {authError}
            </div>
          )}

          <button
            onClick={handleGoogleLogin}
            style={{
              width: "100%",
              background: "linear-gradient(135deg, #a855f7 0%, #6366f1 100%)",
              border: "none",
              color: "#fff",
              padding: "1rem",
              borderRadius: "12px",
              fontWeight: "700",
              fontSize: "1rem",
              cursor: "pointer",
              transition: "all 0.3s ease",
              boxShadow: "0 4px 15px rgba(168, 85, 247, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.75rem"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 6px 20px rgba(168, 85, 247, 0.5)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 15px rgba(168, 85, 247, 0.3)";
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.24 10.285V13.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.859-3.579-7.859-8s3.529-8 7.859-8c2.46 0 4.105 1.025 5.047 1.926l2.427-2.334C18.155 2.502 15.427 1.2 12.24 1.2 6.25 1.2 1.39 6.06 1.39 12s4.86 10.8 10.85 10.8c6.26 0 10.42-4.4 10.42-10.6 0-.715-.077-1.26-.172-1.915H12.24z" />
            </svg>
            Entrar con Google
          </button>
        </div>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {isAuthenticated && <Navbar userEmail={currentUserEmail} userRole={currentUserRole} />}
      <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <h1>AutomYouTube</h1>
          <p>Gestión y Sincronización Automática de Videos</p>
        </div>

        <div className={styles.headerActions}>


          {channel.connected && (
            <button
              onClick={() => setShowLogosManager(true)}
              className={styles.btnSettingsToggle}
              title="Catálogo de Logotipos"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "auto",
                padding: "0 0.8rem",
                gap: "0.4rem",
                fontSize: "0.8rem",
                fontWeight: "600",
                color: "var(--text-primary)"
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>Gestión de Logos</span>
            </button>
          )}


          {loadingChannel ? (
            <div className={styles.channelCard}>Cargando canal...</div>
          ) : channel.connected ? (
            <div className={styles.channelCard}>
              {channel.channel.thumbnail && (
                <img src={channel.channel.thumbnail} alt={channel.channel.title} className={styles.channelAvatar} />
              )}
              <div className={styles.channelInfo}>
                <span className={styles.channelName}>{channel.channel.title}</span>
                <span className={styles.channelStatus}>Conectado</span>
              </div>
              <a
                href={`https://studio.youtube.com/channel/${channel.channel.id}/videos`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.connectBtn}
                style={{
                  width: "auto",
                  padding: "0.4rem 0.8rem",
                  fontSize: "0.8rem",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-color)",
                  textDecoration: "none",
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.25rem"
                }}
              >
                🎥 Ver Studio
              </a>
              <button onClick={disconnectChannel} className={styles.disconnectBtn}>Desconectar</button>
            </div>
          ) : (
            <button
              onClick={() => {
                if (!config.isConfigured) {
                  alert("Configura las credenciales OAuth primero.");
                  setShowSettings(true);
                  return;
                }
                window.location.href = "/api/auth";
              }}
              className={styles.connectBtn}
            >
              Conectar Canal de YouTube
            </button>
          )}
        </div>
      </header>

      {/* Dashboard Grid o Landing de Conexión */}
      {loadingChannel ? (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "5rem 2rem",
          color: "var(--text-secondary)",
          fontSize: "1rem"
        }}>
          <div style={{
            border: "4px solid rgba(168, 85, 247, 0.1)",
            borderTop: "4px solid #a855f7",
            borderRadius: "50%",
            width: "30px",
            height: "30px",
            animation: "spin 1s linear infinite",
            marginBottom: "1rem"
          }} />
          <style dangerouslySetInnerHTML={{
            __html: `
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}} />
          <span>Comprobando canal de YouTube...</span>
        </div>
      ) : (!channel.connected && role === "publicador") ? (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "4rem 2rem",
          background: "rgba(15, 23, 42, 0.3)",
          border: "1px solid var(--border-color)",
          borderRadius: "24px",
          textAlign: "center",
          backdropFilter: "var(--glass-blur)",
          maxWidth: "600px",
          margin: "4rem auto",
          boxShadow: "0 20px 40px -15px rgba(0,0,0,0.5)"
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
            color: "var(--text-primary)",
            marginBottom: "1rem"
          }}>
            Vincula un Canal de YouTube
          </h2>
          <p style={{
            color: "var(--text-secondary)",
            fontSize: "0.95rem",
            lineHeight: "1.6",
            marginBottom: "2.5rem",
            maxWidth: "480px"
          }}>
            Para poder gestionar y automatizar la sincronización de tus vídeos, diseñar portadas personalizadas con inteligencia artificial y programar actualizaciones, es necesario conectar tu canal de YouTube.
          </p>

          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            width: "100%",
            maxWidth: "320px"
          }}>
            <button
              onClick={() => {
                if (!config.isConfigured) {
                  alert("Configura las credenciales OAuth primero. Por favor, contacta con el administrador.");
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
                background: "linear-gradient(135deg, #a855f7 0%, #6366f1 100%)",
                border: "none",
                color: "#fff",
                boxShadow: "0 4px 15px rgba(168, 85, 247, 0.3)",
                transition: "all 0.3s ease"
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 6px 20px rgba(168, 85, 247, 0.5)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 4px 15px rgba(168, 85, 247, 0.3)";
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.517 0-9.388.508a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.871.508 9.388.508 9.388.508s7.517 0 9.388-.508a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              Conectar canal de YouTube
            </button>

            {currentUserRole === "ADMIN" && !config.isConfigured && (
              <button
                onClick={() => {
                  setConfigInput({ GEMINI_API_KEY: "", YOUTUBE_CLIENT_ID: "", YOUTUBE_CLIENT_SECRET: "" });
                  setShowSettings(true);
                }}
                style={{
                  width: "100%",
                  padding: "0.85rem",
                  borderRadius: "12px",
                  fontSize: "0.9rem",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  cursor: "pointer",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid var(--border-color)",
                  color: "var(--text-primary)",
                  transition: "all 0.3s ease"
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
                }}
              >
                ⚙️ Configurar Credenciales OAuth
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.dashboardGrid}>
          {role === "subidor" ? (
            <>
              {/* Formulario Simple de Subida para Subidores */}
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

                  {localExtractedFrame && (
                    <div style={{
                      background: "rgba(255, 255, 255, 0.02)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "12px",
                      padding: "1rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.75rem"
                    }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>
                        🖼️ Portada (miniatura) del vídeo:
                      </span>
                      <img
                        src={localExtractedFrame}
                        alt="Miniatura del vídeo"
                        style={{
                          width: "100%",
                          aspectRatio: "16/9",
                          objectFit: "cover",
                          borderRadius: "8px",
                          border: "1px solid rgba(255, 255, 255, 0.1)"
                        }}
                      />
                      {isExtractingFrames && (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: "0.5rem" }}>
                          ⏳ Capturando fotogramas del vídeo...
                        </div>
                      )}
                      {!isExtractingFrames && capturedFrames.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.25rem" }}>
                          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: "600" }}>
                            🎞️ Elige el fotograma que más te guste:
                          </span>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.4rem" }}>
                            {capturedFrames.map((frame, idx) => {
                              const isSelected = customBgBase64 === frame || localExtractedFrame === frame;
                              return (
                                <div
                                  key={idx}
                                  onClick={() => handleSelectFrame(frame, idx)}
                                  style={{
                                    cursor: "pointer",
                                    borderRadius: "6px",
                                    overflow: "hidden",
                                    border: `2px solid ${isSelected ? "#a855f7" : "transparent"}`,
                                    boxShadow: isSelected ? "0 0 6px rgba(168, 85, 247, 0.4)" : "none",
                                    transition: "all 0.15s ease",
                                    aspectRatio: "16/9"
                                  }}
                                >
                                  <img
                                    src={frame}
                                    alt={`Fotograma ${idx + 1}`}
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

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

                  {/* Programación sugerida de publicación */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1rem", marginBottom: "0.5rem" }}>
                    <input
                      type="checkbox"
                      id="simpleSchedToggle"
                      checked={isSimpleScheduled}
                      disabled={isSimpleUploading}
                      onChange={(e) => setIsSimpleScheduled(e.target.checked)}
                    />
                    <label htmlFor="simpleSchedToggle" style={{ cursor: "pointer", fontSize: "0.85rem", fontWeight: "600", color: "var(--text-secondary)" }}>
                      Sugerir fecha/hora de publicación:
                    </label>
                  </div>

                  {isSimpleScheduled && (
                    <div className={styles.inputGroup} style={{ marginBottom: "1rem" }}>
                      <DateTimePicker
                        required={isSimpleScheduled}
                        value={simpleScheduledAt}
                        onChange={(e) => setSimpleScheduledAt(e.target.value)}
                      />
                    </div>
                  )}

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
                            boxShadow: "0 0 10px rgba(168, 85, 247, 0.5)"
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSimpleUploading}
                    className={styles.btnSubmit}
                    style={{ marginTop: "0.5rem" }}
                  >
                    {isSimpleUploading ? "Subiendo vídeo..." : "🚀 Subir Vídeo a la Cola"}
                  </button>
                </form>
              </div>

              {/* Cola 1 – Subidor (solo lectura): Borradores en YouTube esperando edición */}
              <div className={styles.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <div>
                    <div style={{ fontSize: "0.68rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em", color: "#f59e0b", marginBottom: "0.2rem" }}>Subidor (solo lectura)</div>
                    <h3 style={{ fontSize: "1rem", fontWeight: "700", color: "#f8fafc", margin: 0 }}>Borradores · Pendientes de edición</h3>
                    <p style={{ fontSize: "0.71rem", color: "var(--text-muted)", margin: "0.15rem 0 0 0" }}>Vídeos subidos por el subidor como borrador privado en YouTube, esperando tu edición.</p>
                  </div>
                  <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", padding: "3px 12px", borderRadius: "20px", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {pendingPrivateVideos.length} borrador{pendingPrivateVideos.length !== 1 ? "es" : ""}
                  </span>
                </div>
                {pendingPrivateVideos.length === 0 ? (
                  <div className={styles.emptyState}>No hay borradores pendientes de edición del subidor.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: "320px", overflowY: "auto", paddingRight: "0.25rem" }}>
                    {pendingPrivateVideos.map(video => {
                      const vId = video.id?.videoId || video.id;
                      const dbVid = dbVideos.find(v => v.youtubeId === vId || v.id === vId);
                      const vTitle = dbVid?.title || video.snippet?.title || video.title || "Sin título";
                      const vDate = video.snippet?.publishedAt || video.createdAt;
                      return (
                        <div key={vId} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "0.75rem 1rem",
                          background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)",
                          borderRadius: "10px", gap: "1rem"
                        }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: "0.85rem", fontWeight: "600", color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vTitle}</div>
                            <div style={{ fontSize: "0.71rem", color: "var(--text-muted)", marginTop: "0.2rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                              ID: <code style={{ color: "#94a3b8" }}>{vId}</code>{vDate && <span> · {formatDate(vDate)}</span>}
                              {video.scheduledAt && (
                                <span style={{
                                  color: "#a855f7",
                                  background: "rgba(168,85,247,0.12)",
                                  border: "1px solid rgba(168,85,247,0.25)",
                                  padding: "1px 7px",
                                  borderRadius: "8px",
                                  fontWeight: "700",
                                  fontSize: "0.68rem",
                                  whiteSpace: "nowrap"
                                }}>
                                  📅 Publicar: {formatDate(video.scheduledAt)}
                                </span>
                              )}
                            </div>
                          </div>
                          <span style={{ fontSize: "0.68rem", fontWeight: "700", color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", padding: "2px 9px", borderRadius: "6px", whiteSpace: "nowrap", flexShrink: 0 }}>
                            Borrador · Pendiente de edición
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Procesar Documento PDF (PDF o Word) */}
              <div className={styles.card}>
                <h3 style={{ fontSize: "1.25rem", fontWeight: "800", marginBottom: "1.25rem", background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  📄 Procesar Documento PDF (PDF o Word)
                </h3>

                <form onSubmit={handleAnalyzeFile} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: "0.85rem", fontWeight: "600", color: "var(--text-secondary)" }}>Documento de Referencia (.pdf, .docx)</label>
                    <input
                      type="file"
                      ref={pdfInputRef}
                      multiple
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={(e) => setDocumentFiles(Array.from(e.target.files))}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isAnalyzingFile}
                    className={styles.btnSubmit}
                    style={{
                      background: isAnalyzingFile ? "#4b5563" : "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                      cursor: isAnalyzingFile ? "not-allowed" : "pointer",
                      marginTop: "0.5rem"
                    }}
                  >
                    {isAnalyzingFile ? "Procesando Documento PDF..." : "Analizar Documento"}
                  </button>
                </form>

                {isAnalyzingFile && (
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "2rem",
                    gap: "1rem",
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid var(--border-color, rgba(255, 255, 255, 0.08))",
                    borderRadius: "16px",
                    marginTop: "1.5rem"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                      <div style={{
                        border: "3px solid rgba(168, 85, 247, 0.1)",
                        borderTop: "3px solid #a855f7",
                        borderRadius: "50%",
                        width: "24px",
                        height: "24px",
                        animation: "spin 1s linear infinite"
                      }} />
                      <span style={{ fontSize: "1.1rem", fontWeight: "700", color: "#a855f7" }}>
                        {analyzeProgress}%
                      </span>
                    </div>
                    <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", fontWeight: "500" }}>
                      Analizando estructura de programas y vídeos...
                    </span>
                    <div style={{
                      width: "100%",
                      height: "6px",
                      backgroundColor: "rgba(255, 255, 255, 0.05)",
                      borderRadius: "3px",
                      overflow: "hidden"
                    }}>
                      <div style={{
                        width: `${analyzeProgress}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, #a855f7 0%, #ec4899 100%)",
                        transition: "width 0.3s ease"
                      }} />
                    </div>
                  </div>
                )}
              </div>



              {/* Cola 1 – Editor: Borradores en YouTube listos para editar */}
              <div className={styles.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <div>
                    <div style={{ fontSize: "0.68rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em", color: "#f59e0b", marginBottom: "0.2rem" }}>Editor</div>
                    <h3 style={{ fontSize: "1rem", fontWeight: "700", color: "#f8fafc", margin: 0 }}>Borradores · Pendientes de edición</h3>
                    <p style={{ fontSize: "0.71rem", color: "var(--text-muted)", margin: "0.15rem 0 0 0" }}>Borradores privados y vídeos ocultos en YouTube esperando que los completes y publiques.</p>
                  </div>
                  <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", padding: "3px 12px", borderRadius: "20px", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {pendingPrivateVideos.length} borrador{pendingPrivateVideos.length !== 1 ? "es" : ""}
                  </span>
                </div>
                {pendingPrivateVideos.length === 0 ? (
                  <div className={styles.emptyState}>No hay borradores pendientes. Cuando el subidor suba un vídeo aparecerá aquí.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: "350px", overflowY: "auto", paddingRight: "0.25rem" }}>
                    {pendingPrivateVideos.map(video => {
                      const ytId = video.id?.videoId || video.id;
                      const dbVid = dbVideos.find(v => v.youtubeId === ytId || v.id === ytId);
                      const vTitle = dbVid?.title || video.snippet?.title || video.title || "Sin título";
                      const vDate = dbVid?.createdAt || video.snippet?.publishedAt || video.createdAt;
                      const vId = video.id?.videoId || video.id;
                      const vThumb = dbVid?.thumbnail || video.thumbnail || video.snippet?.thumbnails?.medium?.url;
                      const scheduledDate = dbVid?.scheduledAt || video.scheduledAt;

                      const isUploading = dbVid?.status === "UPLOADING" || video.status === "UPLOADING";
                      const uploadPercent = dbVid?.uploadProgress || video.uploadProgress || 0;

                      return (
                        <div key={vId} style={{
                          display: "flex", flexDirection: "column",
                          padding: "0.75rem 1rem",
                          background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)",
                          borderRadius: "10px", gap: "0.5rem"
                        }}>
                          {/* Fila principal */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: "1rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0, flex: 1 }}>
                              {vThumb && (
                                <img
                                  src={vThumb}
                                  alt=""
                                  onError={(e) => {
                                    e.target.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%231e293b'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='10' fill='%2364748b'>Sin Portada</text></svg>";
                                  }}
                                  style={{ width: "64px", aspectRatio: "16/9", objectFit: "cover", borderRadius: "6px", flexShrink: 0 }}
                                />
                              )}
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: "0.85rem", fontWeight: "600", color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vTitle}</div>
                                <div style={{ fontSize: "0.71rem", color: "var(--text-muted)", marginTop: "0.2rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                                  ID: <code style={{ color: "#94a3b8" }}>{vId}</code>{vDate && <span> · Subido el {formatDate(vDate)}</span>}
                                  {scheduledDate && (
                                    <span style={{
                                      color: "#a855f7",
                                      background: "rgba(168,85,247,0.12)",
                                      border: "1px solid rgba(168,85,247,0.25)",
                                      padding: "1px 7px",
                                      borderRadius: "8px",
                                      fontWeight: "700",
                                      fontSize: "0.68rem",
                                      whiteSpace: "nowrap"
                                    }}>
                                      📅 Publicar: {formatDate(scheduledDate)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                              <span style={{ fontSize: "0.68rem", fontWeight: "700", color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", padding: "2px 9px", borderRadius: "6px", whiteSpace: "nowrap" }}>
                                {dbVid && !dbVid.youtubeId ? "Borrador PDF" : "Borrador YouTube"}
                              </span>

                              {/* Botón para cambiar o vincular vídeo */}
                              {dbVid && dbVid.youtubeId && (
                                <button
                                  type="button"
                                  onClick={() => setShowSearchForCard(prev => ({ ...prev, [dbVid.id]: !prev[dbVid.id] }))}
                                  style={{
                                    background: "rgba(168, 85, 247, 0.15)",
                                    border: "1px solid rgba(168, 85, 247, 0.3)",
                                    color: "#c084fc",
                                    fontSize: "0.72rem",
                                    padding: "0.35rem 0.6rem",
                                    borderRadius: "6px",
                                    cursor: "pointer"
                                  }}
                                  title="Vincular a otro vídeo de YouTube"
                                >
                                  🔗
                                </button>
                              )}

                              {isUploading && (
                                <span style={{
                                  fontSize: "0.72rem",
                                  fontWeight: "700",
                                  color: "#38bdf8",
                                  background: "rgba(56,189,248,0.12)",
                                  border: "1px solid rgba(56,189,248,0.25)",
                                  padding: "2px 9px",
                                  borderRadius: "6px",
                                  whiteSpace: "nowrap"
                                }}>⚡ Subiendo...</span>
                              )}
                              <button
                                type="button"
                                disabled={isUploading}
                                onClick={() => {
                                  // Buscar el registro completo en la BD para tener acceso al filePath
                                  const dbRecord = dbVideos.find(dbv =>
                                    dbv.youtubeId === vId || dbv.id === vId || dbv.id === video.dbId
                                  );

                                  if (video.isLocalDraft || (dbRecord && !dbRecord.youtubeId)) {
                                    // Vídeo local: usar handleSelectLocalVideo con el registro completo de BD
                                    if (dbRecord) {
                                      handleSelectLocalVideo(dbRecord);
                                    } else {
                                      // Fallback: construir objeto mínimo
                                      handleSelectLocalVideo({
                                        id: vId,
                                        title: vTitle,
                                        description: video.description || video.snippet?.description || "",
                                        filePath: null,
                                        filename: video.fileName || "",
                                        tags: video.tags || "",
                                        status: "LOCAL_DRAFT"
                                      });
                                    }
                                  } else {
                                    // Vídeo de YouTube: usar handleSelectVideo con el ID de YouTube
                                    const videoObj = {
                                      id: vId,
                                      title: vTitle,
                                      description: video.description || video.snippet?.description || "",
                                      thumbnail: vThumb || "",
                                      tags: video.tags || (video.snippet?.tags ? video.snippet.tags.join(", ") : ""),
                                      privacyStatus: video.privacyStatus || video.snippet?.status?.privacyStatus || "private",
                                      fileName: video.fileName || video.fileDetails?.fileName || dbRecord?.filename || "",
                                      publishedAt: video.publishedAt || video.snippet?.publishedAt || null
                                    };
                                    handleSelectVideo(videoObj);
                                  }
                                  setTimeout(() => {
                                    document.querySelector("[class*='inlineEditPanel']")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }, 200);
                                }}
                                className={styles.btnSubmit}
                                style={{
                                  width: "auto",
                                  fontSize: "0.72rem",
                                  padding: "0.35rem 0.75rem",
                                  background: isUploading ? "rgba(255, 255, 255, 0.05)" : "rgba(168, 85, 247, 0.15)",
                                  color: isUploading ? "#64748b" : "#c084fc",
                                  border: isUploading ? "1px solid rgba(255, 255, 255, 0.1)" : "1px solid rgba(168, 85, 247, 0.35)",
                                  borderRadius: "6px",
                                  cursor: isUploading ? "not-allowed" : "pointer",
                                  fontWeight: "700",
                                  opacity: isUploading ? 0.6 : 1,
                                  whiteSpace: "nowrap"
                                }}
                                title={isUploading ? "El vídeo se está subiendo y no se puede editar todavía" : "Abrir en el editor"}
                              >
                                ✏️ Editar
                              </button>

                              {/* Botón para desvincular si tiene youtubeId */}
                              {dbVid && dbVid.youtubeId && (
                                <button
                                  type="button"
                                  onClick={() => handleUnlinkCardFromYoutube(dbVid.id)}
                                  style={{
                                    background: "rgba(245, 158, 11, 0.15)",
                                    border: "1px solid rgba(245, 158, 11, 0.3)",
                                    color: "#f59e0b",
                                    fontSize: "0.72rem",
                                    padding: "0.35rem 0.6rem",
                                    borderRadius: "6px",
                                    cursor: "pointer"
                                  }}
                                  title="Desvincular vídeo de YouTube"
                                >
                                  🔗✕
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={async () => {
                                  if (window.confirm("¿Estás seguro de que deseas eliminar este borrador de la lista? Se borrará de la base de datos local y dejará de aparecer en esta cola.")) {
                                    try {
                                      const ytId = video.id?.videoId || video.id;
                                      const dbVideo = dbVideos.find(dbv => dbv.youtubeId === ytId);
                                      const dbId = dbVideo?.id || video.dbId || video.id;
                                      const res = await fetch(`/api/videos?id=${dbId}`, { method: "DELETE" });
                                      if (res.ok) {
                                        alert("Borrador eliminado correctamente de la base de datos.");
                                        fetchScheduledUpdates();
                                      } else {
                                        const errData = await res.json();
                                        alert(`Error al eliminar: ${errData.error || 'error desconocido'}`);
                                      }
                                    } catch (err) {
                                      alert(`Error de red al intentar eliminar: ${err.message}`);
                                    }
                                  }
                                }}
                                className={styles.btnDelete}
                                style={{
                                  width: "auto",
                                  fontSize: "0.72rem",
                                  padding: "0.35rem 0.6rem",
                                  background: "rgba(239, 68, 68, 0.15)",
                                  color: "#ef4444",
                                  border: "1px solid rgba(239, 68, 68, 0.3)",
                                  borderRadius: "6px",
                                  cursor: "pointer"
                                }}
                                title="Eliminar borrador de la aplicación"
                              >
                                ✕
                              </button>
                            </div>
                          </div>

                          {/* Fila inferior: Buscador manual */}
                          {dbVid && (!dbVid.youtubeId || showSearchForCard[dbVid.id]) && (
                            <div style={{
                              marginTop: "0.5rem",
                              borderTop: "1px dashed rgba(255,255,255,0.08)",
                              paddingTop: "0.5rem",
                              width: "100%",
                              position: "relative"
                            }}>
                              <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                                { !dbVid.youtubeId 
                                  ? "⚠️ Este borrador no está vinculado a YouTube. Vincula un vídeo:" 
                                  : "🔍 Cambiar vinculación de vídeo en YouTube:" }
                              </div>
                              <div style={{ display: "flex", gap: "0.5rem", position: "relative" }}>
                                <input
                                  type="text"
                                  placeholder="Buscar vídeo en el canal (título, ID o URL)..."
                                  value={cardSearchQueries[dbVid.id] || ""}
                                  onChange={(e) => handleCardVideoSearch(dbVid.id, e.target.value)}
                                  style={{
                                    flex: 1,
                                    padding: "0.35rem 0.5rem",
                                    fontSize: "0.75rem",
                                    background: "var(--bg-surface-solid, #1e293b)",
                                    color: "#fff",
                                    border: "1px solid var(--border-color, #334155)",
                                    borderRadius: "6px"
                                  }}
                                />
                                {cardSearchQueries[dbVid.id] && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCardSearchQueries(prev => { const next = { ...prev }; delete next[dbVid.id]; return next; });
                                      setCardSearchResults(prev => { const next = { ...prev }; delete next[dbVid.id]; return next; });
                                    }}
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      color: "var(--text-muted)",
                                      cursor: "pointer",
                                      fontSize: "0.75rem"
                                    }}
                                  >✕</button>
                                )}
                              </div>

                              {/* Resultados de búsqueda */}
                              {cardSearchResults[dbVid.id] && cardSearchResults[dbVid.id].length > 0 && (
                                <div style={{
                                  position: "absolute",
                                  zIndex: 100,
                                  background: "#0f172a",
                                  border: "1px solid #334155",
                                  borderRadius: "6px",
                                  marginTop: "2px",
                                  maxHeight: "180px",
                                  overflowY: "auto",
                                  width: "100%",
                                  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5)"
                                }}>
                                  {cardSearchResults[dbVid.id].map(res => (
                                    <div
                                      key={res.id}
                                      onClick={() => handleLinkCardToYoutube(dbVid.id, res.id, res.title)}
                                      style={{
                                        padding: "0.4rem 0.6rem",
                                        cursor: "pointer",
                                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                                        fontSize: "0.72rem",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "0.5rem"
                                      }}
                                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)"}
                                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                    >
                                      {res.thumbnail && (
                                        <img
                                          src={res.thumbnail}
                                          alt=""
                                          onError={(e) => {
                                            e.target.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%231e293b'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='10' fill='%2364748b'>Sin Portada</text></svg>";
                                          }}
                                          style={{ width: "32px", aspectRatio: "16/9", objectFit: "cover", borderRadius: "3px" }}
                                        />
                                      )}
                                      <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ color: "#fff", fontWeight: "600", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                                          {res.title}
                                        </div>
                                        <div style={{ color: "#94a3b8", fontSize: "0.65rem" }}>
                                          ID: {res.id} · {res.privacyStatus === 'public' ? 'Público' : res.privacyStatus === 'unlisted' ? 'Oculto' : 'Privado'}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {cardSearchLoading[dbVid.id] && (
                                <div style={{ fontSize: "0.68rem", color: "#a855f7", marginTop: "2px" }}>Buscando en YouTube...</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}


          {/* Formulario de Edición (Si hay un video seleccionado) */}
          {selectedYoutubeVideo && (
            <form id="inline-edit-form" onSubmit={(e) => handleSaveVideo(e)} className={styles.inlineEditPanel} style={{ display: "block", marginTop: "1.5rem" }}>
              <div className={styles.inlineEditHeader}>
                <div>
                  <h3>✏️ Editor de YouTube</h3>
                  <span style={{ fontSize: "0.8rem", color: "#a855f7", fontWeight: "600" }}>
                    Vídeo seleccionado: {selectedYoutubeVideo.title.substring(0, 50)}...
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCloseEditor}
                  className={styles.closeBtn}
                >✕</button>
              </div>

              {/* Estado de "Pendiente de Sincronización" */}
              <div style={{
                border: "1px solid #a855f7",
                borderRadius: "8px",
                padding: "0.75rem",
                marginBottom: "1rem",
                background: "rgba(168, 85, 247, 0.05)",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem"
              }}>
                <span style={{ fontSize: "1.1rem" }}>📋</span>
                <div>
                  <strong>Estado actual:</strong> Listo para edición.
                  <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Los datos correspondientes se han cargado en el editor. Realiza tus cambios y sincroniza con YouTube para aplicar.
                  </span>
                </div>
              </div>


              {/* Vincular con Borrador de YouTube (Selección Manual) */}
              <div style={{
                border: "1px solid var(--border-color, #334155)",
                borderRadius: "8px",
                padding: "0.75rem 1rem",
                marginBottom: "1rem",
                background: "rgba(255, 255, 255, 0.01)",
                position: "relative"
              }}>
                <label style={{
                  fontSize: "0.75rem",
                  fontWeight: "600",
                  color: "var(--text-secondary, #94a3b8)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.3rem",
                  marginBottom: "0.4rem"
                }}>
                  <span>🔗 Vincular con Borrador de YouTube (Selección Manual)</span>
                </label>
                <div style={{ display: "flex", gap: "0.5rem", position: "relative" }}>
                  <input
                    type="text"
                    placeholder="Buscar borrador por título o pegar URL/ID en YouTube..."
                    value={ytDraftSearchQuery}
                    onChange={(e) => {
                      setYtDraftSearchQuery(e.target.value);
                      setShowYtDraftSearchDropdown(true);
                    }}
                    onFocus={() => {
                      setShowYtDraftSearchDropdown(true);
                      fetchYtDraftsForSelector(ytDraftSearchQuery);
                    }}
                    style={{
                      flex: 1,
                      padding: "0.4rem 0.6rem",
                      fontSize: "0.75rem",
                      background: "var(--bg-surface-solid, #1e293b)",
                      color: "var(--text-primary, #f8fafc)",
                      border: "1px solid var(--border-color, #334155)",
                      borderRadius: "6px"
                    }}
                  />
                  {ytDraftSearchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setYtDraftSearchQuery("");
                        fetchYtDraftsForSelector("");
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--text-muted, #94a3b8)",
                        cursor: "pointer",
                        fontSize: "0.8rem",
                        padding: "0 0.4rem"
                      }}
                    >✕</button>
                  )}
                  {showYtDraftSearchDropdown && (
                    <button
                      type="button"
                      onClick={() => setShowYtDraftSearchDropdown(false)}
                      style={{
                        background: "rgba(255, 255, 255, 0.05)",
                        border: "1px solid var(--border-color, #334155)",
                        color: "var(--text-primary, #f8fafc)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                        padding: "0.4rem 0.6rem"
                      }}
                    >Cerrar</button>
                  )}
                </div>

                {showYtDraftSearchDropdown && (
                  <div style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: "0.25rem",
                    background: "var(--bg-surface, #0f172a)",
                    border: "1px solid var(--border-color, #334155)",
                    borderRadius: "8px",
                    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5)",
                    maxHeight: "180px",
                    overflowY: "auto",
                    zIndex: 110,
                    padding: "0.4rem"
                  }}>
                    {loadingYtDrafts ? (
                      <div style={{ padding: "0.5rem", fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
                        Buscando borradores de YouTube...
                      </div>
                    ) : ytDraftSearchResults.length === 0 ? (
                      <div style={{ padding: "0.5rem", fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
                        No se encontraron videos privados o de borrador en el canal.
                      </div>
                    ) : (
                      ytDraftSearchResults.map((draft) => (
                        <div
                          key={draft.id}
                          onClick={() => handleLinkYoutubeDraft(draft)}
                          style={{
                            padding: "0.5rem",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            borderBottom: "1px solid rgba(255,255,255,0.02)",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            transition: "background 0.2s"
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                        >
                          {draft.thumbnail && (
                            <img src={draft.thumbnail} alt="" style={{ width: "40px", aspectRatio: "16/9", objectFit: "cover", borderRadius: "3px" }} />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: "600", color: "#f8fafc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {draft.title}
                            </div>
                            <div style={{ color: "var(--text-muted, #94a3b8)", fontSize: "0.7rem" }}>
                              ID: {draft.id} | Estado: {draft.privacyStatus === 'private' ? 'Borrador Privado' : 'Oculto'}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className={styles.inlineEditContent}>
                {/* Columna Izquierda: Sugerencias e Información */}
                <div className={styles.inlineEditColLeft}>
                  <div className={styles.selectedVideoPreview}>
                    <img
                      src={selectedYoutubeVideo.thumbnail || `/api/videos/thumbnail?id=${selectedYoutubeVideo.id}`}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%231e293b'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='10' fill='%2364748b'>Sin Portada</text></svg>";
                      }}
                      alt="Preview"
                      className={styles.selectedVideoThumbnail}
                    />
                    <div className={styles.selectedVideoInfo}>
                      <h5 style={{ fontSize: "0.85rem", margin: 0 }}>{selectedYoutubeVideo.title}</h5>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>ID: {selectedYoutubeVideo.id}</span>
                    </div>
                  </div>

                  {/* Portada / Miniatura estilo TVG */}
                  <div style={{
                    border: "1px solid var(--border-color)",
                    borderRadius: "12px",
                    padding: "1rem",
                    background: "rgba(255,255,255,0.01)"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                      <span style={{ fontWeight: "600", fontSize: "0.85rem" }}>
                        🎨 Miniatura Automática estilo TVG
                      </span>
                      <label className={styles.switch} style={{ position: "relative", display: "inline-block", width: "40px", height: "20px" }}>
                        <input
                          type="checkbox"
                          checked={isAutoThumbnailEnabled}
                          onChange={(e) => {
                            setIsAutoThumbnailEnabled(e.target.checked);
                            if (!e.target.checked) setNewThumbnailBase64(null);
                          }}
                          style={{ opacity: 0, width: 0, height: 0 }}
                        />
                        <span style={{
                          position: "absolute", cursor: "pointer",
                          top: 0, left: 0, right: 0, bottom: 0,
                          backgroundColor: isAutoThumbnailEnabled ? "#10b981" : "#4b5563",
                          transition: "0.2s", borderRadius: "20px"
                        }}>
                          <span style={{
                            position: "absolute", content: "''",
                            height: "14px", width: "14px",
                            left: isAutoThumbnailEnabled ? "22px" : "4px", bottom: "3px",
                            backgroundColor: "white", transition: "0.2s", borderRadius: "50%"
                          }} />
                        </span>
                      </label>
                    </div>

                    {isAutoThumbnailEnabled ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <div style={{ position: "relative", width: "100%", maxWidth: "320px", aspectRatio: "16/9", borderRadius: "6px", overflow: "hidden", border: "1px solid var(--border-color)", background: "#000" }}>
                          {isExtractingFrame ? (
                            <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#a855f7", fontSize: "0.8rem", gap: "0.5rem", padding: "1rem", textAlign: "center" }}>
                              <span style={{ fontSize: "1.5rem" }}>🎞️</span>
                              <span>Extrayendo fotograma del vídeo...</span>
                            </div>
                          ) : newThumbnailBase64 ? (
                            <img src={newThumbnailBase64} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                              {isGeneratingThumbnail ? "Componiendo lienzo..." : "Preparando canvas..."}
                            </div>
                          )}
                        </div>



                        <div className={styles.inputGroup} style={{ margin: 0 }}>
                          <label style={{ fontSize: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>
                              Texto SEO Gallego (
                              <span style={{
                                fontWeight: "bold",
                                color: (getWordCount(thumbnailText) >= 3 && getWordCount(thumbnailText) <= 5) ? "#22c55e" : "#f59e0b"
                              }}>
                                (3-5 palabras)
                              </span>
                              )
                            </span>
                            <button
                              type="button"
                              disabled={isGeneratingSeoPhrase}
                              onClick={async () => {
                                if (!updateForm.title) {
                                  alert("Introduce un título primero para generar la frase SEO.");
                                  return;
                                }
                                setIsGeneratingSeoPhrase(true);
                                try {
                                  const res = await fetch("/api/youtube/generate-seo-phrase", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ title: updateForm.title, description: updateForm.description })
                                  });
                                  if (res.ok) {
                                    const data = await res.json();
                                    if (data.thumbnailText) {
                                      setThumbnailText(data.thumbnailText);
                                    }
                                  } else {
                                    alert("Error al generar la frase SEO.");
                                  }
                                } catch (err) {
                                  console.error(err);
                                  alert("Error de red al conectar con Gemini.");
                                } finally {
                                  setIsGeneratingSeoPhrase(false);
                                }
                              }}
                              className={styles.btnSubmit}
                              style={{
                                width: "auto",
                                fontSize: "0.7rem",
                                padding: "2px 8px",
                                margin: 0,
                                background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                                border: "none",
                                opacity: isGeneratingSeoPhrase ? 0.6 : 1,
                                cursor: isGeneratingSeoPhrase ? "not-allowed" : "pointer"
                              }}
                            >
                              {isGeneratingSeoPhrase ? "Generando..." : "🪄 Generar con IA"}
                            </button>
                          </label>
                          <input
                            type="text"
                            value={thumbnailText}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/gu, "");
                              setThumbnailText(val);
                            }}
                            placeholder="Ej: GRAN CONCURSO HORA GALEGA"
                          />
                          {thumbnailText && (getWordCount(thumbnailText) < 3 || getWordCount(thumbnailText) > 5) && (
                            <span style={{ fontSize: "0.7rem", color: "#f59e0b", marginTop: "0.25rem", display: "block", fontWeight: "500" }}>
                              ⚠️ La frase debe tener entre 3 y 5 palabras para encajar bien en el diseño.
                            </span>
                          )}
                          {isGeneratingSeoPhrase && (
                            <div style={{
                              marginTop: "0.4rem",
                              height: "4px",
                              width: "100%",
                              backgroundColor: "rgba(255,255,255,0.05)",
                              borderRadius: "2px",
                              overflow: "hidden",
                              position: "relative"
                            }}>
                              <div className={styles.pulseProgressBar} />
                            </div>
                          )}
                        </div>

                        <div className={styles.inputGroup} style={{ margin: 0 }}>
                          <label style={{ fontSize: "0.75rem", display: "flex", justifyContent: "space-between" }}>
                            <span>Logotipo de Programa (Catálogo)</span>
                          </label>
                          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                            <div style={{ position: "relative", display: "inline-block", flex: 1 }}>
                              <button
                                type="button"
                                className={styles.btnSubmit}
                                style={{
                                  padding: "0.4rem 0.6rem",
                                  fontSize: "0.75rem",
                                  background: "var(--bg-surface-solid, #1e293b)",
                                  color: "var(--text-primary, #f8fafc)",
                                  border: "1px solid var(--border-color, #334155)",
                                  borderRadius: "6px",
                                  cursor: "pointer",
                                  width: "100%",
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center"
                                }}
                                onClick={() => setLogoDropdownOpen(!logoDropdownOpen)}
                              >
                                {selectedProgramLogo === "none"
                                  ? "Ninguno (Sin logotipo)"
                                  : selectedProgramLogo.replace(/\.[^/.]+$/, "").replace(/_/g, " ")}
                                <span style={{ marginLeft: "0.3rem" }}>▾</span>
                              </button>
                              {logoDropdownOpen && (
                                <ul
                                  style={{
                                    position: "absolute",
                                    top: "100%",
                                    left: 0,
                                    right: 0,
                                    marginTop: "0.2rem",
                                    padding: "0.4rem",
                                    background: "var(--bg-surface, #0f172a)",
                                    border: "1px solid var(--border-color, #334155)",
                                    borderRadius: "6px",
                                    listStyle: "none",
                                    maxHeight: "200px",
                                    overflowY: "auto",
                                    zIndex: 10,
                                  }}
                                >
                                  <li
                                    key="none"
                                    style={{ padding: "0.4rem", cursor: "pointer", borderRadius: "4px" }}
                                    onClick={() => {
                                      handleLogoChange("none");
                                      setLogoDropdownOpen(false);
                                    }}
                                  >
                                    Ninguno (Sin logotipo)
                                  </li>
                                  {programLogosCatalog.map((logo) => {
                                    const logoName = typeof logo === "string" ? logo : logo.name;
                                    return (
                                      <li
                                        key={logoName}
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          alignItems: "center",
                                          padding: "0.4rem",
                                          borderRadius: "4px"
                                        }}
                                      >
                                        <span
                                          style={{ cursor: "pointer", flex: 1 }}
                                          onClick={() => {
                                            handleLogoChange(logoName);
                                            setLogoDropdownOpen(false);
                                          }}
                                        >
                                          {logoName.replace(/\.[^/.]+$/, "").replace(/_/g, " ")}
                                        </span>
                                        <button
                                          type="button"
                                          aria-label={`Eliminar ${logoName}`}
                                          style={{
                                            background: "transparent",
                                            border: "none",
                                            color: "#ef4444",
                                            cursor: "pointer",
                                            fontSize: "0.9rem",
                                            padding: "0 0.2rem"
                                          }}
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            if (!confirm(`¿Eliminar el logotipo "${logoName}"?`)) return;
                                            try {
                                              const res = await fetch("/api/program-logos", {
                                                method: "DELETE",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify({ filename: logoName }),
                                              });
                                              if (res.ok) {
                                                await fetchProgramLogosCatalog();
                                                if (selectedProgramLogo === logoName) setSelectedProgramLogo("none");
                                              } else {
                                                const data = await res.json();
                                                alert("Error al eliminar logotipo: " + (data.error || "error desconocido"));
                                              }
                                            } catch (err) {
                                              console.error("Error al eliminar logotipo:", err);
                                              alert("Error de red o de cliente: " + err.message);
                                            }
                                          }}
                                        >
                                          ✖
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>
                            <label
                              className={styles.btnSubmit}
                              style={{
                                padding: "0.4rem 0.6rem",
                                fontSize: "0.75rem",
                                cursor: logoUploadProgress !== null ? "not-allowed" : "pointer",
                                opacity: logoUploadProgress !== null ? 0.6 : 1,
                                display: "inline-block",
                                textAlign: "center",
                                whiteSpace: "nowrap",
                                margin: 0,
                                width: "auto",
                                color: "#fff",
                              }}
                            >
                              {logoUploadProgress !== null ? "Subiendo..." : "Subir Logo"}
                              <input
                                type="file"
                                accept="image/png"
                                disabled={logoUploadProgress !== null}
                                onChange={async (e) => {
                                  const file = e.target.files[0];
                                  if (file) {
                                    uploadLogoWithProgress(
                                      file,
                                      async (data) => {
                                        await fetchProgramLogosCatalog();
                                        setSelectedProgramLogo(data.filename);
                                      },
                                      (err) => {
                                        alert("Error subiendo logotipo: " + err.message);
                                      }
                                    );
                                  }
                                }}
                                style={{ display: "none" }}
                              />
                            </label>
                            {logoUploadProgress !== null && (
                              <div style={{ width: "100%", marginTop: "0.5rem" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>
                                  <span>Subiendo...</span>
                                  <span>{logoUploadProgress}%</span>
                                </div>
                                <div className={styles.batchSyncProgressOuter} style={{ height: "4px", marginTop: 0 }}>
                                  <div
                                    className={styles.batchSyncProgressInner}
                                    style={{
                                      width: `${logoUploadProgress}%`,
                                      background: "linear-gradient(90deg, #a855f7 0%, #ec4899 100%)",
                                      boxShadow: "0 0 6px rgba(168, 85, 247, 0.4)"
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Imagen convencional de portada:</label>
                        <input type="file" accept="image/*" onChange={handleNewThumbnailSelect} style={{ background: "transparent", border: "none" }} />
                        {newThumbnailBase64 && (
                          <div style={{ marginTop: "0.5rem", position: "relative", width: "160px" }}>
                            <img src={newThumbnailBase64} alt="Thumb" style={{ width: "100%", borderRadius: "6px" }} />
                            <button type="button" onClick={() => setNewThumbnailBase64(null)} style={{ position: "absolute", top: "-5px", right: "-5px", background: "#ef4444", color: "#fff", border: "none", borderRadius: "50%", cursor: "pointer", width: "18px", height: "18px", fontSize: "10px" }}>✕</button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Selector de fotogramas fijos para miniatura automática */}
                    {selectedYoutubeVideo && (() => {
                      const hasLocalVideo = videoDuration > 0;
                      if (!hasLocalVideo) {
                        return (
                          <div style={{
                            fontSize: "0.72rem",
                            color: "var(--text-secondary)",
                            textAlign: "center",
                            padding: "0.8rem 1rem",
                            background: "rgba(100, 116, 139, 0.08)",
                            border: "1px solid rgba(100, 116, 139, 0.25)",
                            borderRadius: "12px",
                            marginTop: "0.75rem",
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.6rem",
                            alignItems: "center"
                          }}>
                            <span style={{ fontWeight: "500" }}>
                              ℹ️ Vídeo no disponible en el servidor. Selecciona el archivo en tu PC para extraer fotogramas:
                            </span>
                            <input
                              type="file"
                              accept="video/*"
                              style={{
                                fontSize: "0.72rem",
                                color: "var(--text-secondary)",
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "8px",
                                padding: "0.4rem 0.6rem",
                                cursor: "pointer",
                                width: "100%",
                                maxWidth: "250px"
                              }}
                              onChange={(e) => {
                                const file = e.target.files[0];
                                if (file) {
                                  const url = URL.createObjectURL(file);
                                  if (videoObjectURL) {
                                    URL.revokeObjectURL(videoObjectURL);
                                  }
                                  setVideoObjectURL(url);
                                  if (hiddenVideoRef.current) {
                                    hiddenVideoRef.current.src = url;
                                    hiddenVideoRef.current.load();
                                  }
                                }
                              }}
                            />
                          </div>
                        );
                      }
                      return (
                        <div style={{ marginTop: "0.75rem" }}>
                          {isExtractingFrames && (
                            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textAlign: "center", padding: "0.5rem" }}>
                              ⏳ Capturando fotogramas del vídeo...
                            </div>
                          )}
                          {!isExtractingFrames && capturedFrames.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: "600" }}>
                                🎞️ Selecciona un fotograma del vídeo:
                              </span>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(85px, 1fr))", gap: "0.4rem" }}>
                                {capturedFrames.map((frame, idx) => {
                                  const isSelected = customBgBase64 === frame || localExtractedFrame === frame;
                                  return (
                                    <div
                                      key={idx}
                                      onClick={() => handleSelectFrame(frame, idx)}
                                      style={{
                                        cursor: "pointer",
                                        borderRadius: "6px",
                                        overflow: "hidden",
                                        border: `2px solid ${isSelected ? "#a855f7" : "transparent"}`,
                                        boxShadow: isSelected ? "0 0 6px rgba(168, 85, 247, 0.4)" : "none",
                                        transition: "all 0.15s ease",
                                        aspectRatio: "16/9"
                                      }}
                                    >
                                      <img
                                        src={frame}
                                        alt={`Fotograma ${idx + 1}`}
                                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    <canvas ref={canvasRef} style={{ display: "none" }} />
                  </div>
                </div>

                {/* Columna Derecha: Campos e Miniatura */}
                <div className={styles.inlineEditColRight}>
                  <div className={styles.inputGroup}>
                    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>Título en YouTube (Copiar/Pegar literal)</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <button
                          type="button"
                          disabled={isOptimizingTitle}
                          onClick={() => handleOptimizeFieldWithAI(
                            updateForm.title,
                            'title',
                            (val) => setUpdateForm(prev => ({ ...prev, title: val })),
                            setIsOptimizingTitle
                          )}
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
                          {isOptimizingTitle ? "Generando..." : "🪄 Generar con IA"}
                        </button>
                        <span style={{ fontSize: "0.75rem", color: updateForm.title.length >= 90 ? "#ef4444" : "var(--text-muted)" }}>
                          {updateForm.title.length}/100
                        </span>
                      </div>
                    </label>
                    <textarea
                      rows="2"
                      required
                      maxLength={100}
                      value={updateForm.title}
                      onChange={(e) => setUpdateForm({ ...updateForm, title: e.target.value })}
                      onPaste={(e) => handleCleanPaste(e, (val) => setUpdateForm(prev => ({ ...prev, title: val })))}
                      style={{ resize: "none" }}
                    />
                    {isOptimizingTitle && (
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
                      <span>Descripción (Copiar/Pegar literal)</span>
                      <button
                        type="button"
                        disabled={isOptimizingDesc}
                        onClick={() => handleOptimizeFieldWithAI(
                          updateForm.description,
                          'description',
                          (val) => setUpdateForm(prev => ({ ...prev, description: val })),
                          setIsOptimizingDesc
                        )}
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
                        {isOptimizingDesc ? "Generando..." : "🪄 Generar con IA"}
                      </button>
                    </label>
                    <textarea
                      rows="8"
                      required
                      value={updateForm.description}
                      onChange={(e) => setUpdateForm({ ...updateForm, description: e.target.value })}
                      onPaste={(e) => handleCleanPaste(e, (val) => setUpdateForm(prev => ({ ...prev, description: val })))}
                    />
                    {isOptimizingDesc && (
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





                  {/* Lista de reproducción - Buscador con filtro */}
                  <div className={styles.inputGroup} style={{ marginTop: "1rem" }}>
                    <label htmlFor="playlistSearch" style={{ fontSize: "0.85rem", fontWeight: "600" }}>
                      Añadir a Lista de Reproducción de YouTube:
                    </label>
                    <div style={{ position: "relative", marginTop: "0.25rem" }}>
                      <input
                        id="playlistSearch"
                        type="text"
                        placeholder={playlists.find(pl => pl.id === updateForm.playlistId)?.title || "Buscar playlist..."}
                        value={playlistFilterSingle}
                        onFocus={() => setPlaylistFilterSingleOpen(true)}
                        onBlur={() => setTimeout(() => setPlaylistFilterSingleOpen(false), 150)}
                        onChange={(e) => { setPlaylistFilterSingle(e.target.value); setPlaylistFilterSingleOpen(true); }}
                        style={{
                          padding: "0.5rem",
                          background: "var(--bg-surface, #0f172a)",
                          border: "1px solid var(--border-color, #334155)",
                          borderRadius: "6px",
                          color: "#fff",
                          width: "100%",
                          fontSize: "0.85rem",
                          boxSizing: "border-box"
                        }}
                      />
                      {playlistFilterSingleOpen && (
                        <ul style={{
                          position: "absolute", top: "100%", left: 0, right: 0,
                          background: "#0f172a",
                          border: "1px solid var(--border-color, #334155)",
                          borderRadius: "6px", margin: "0.2rem 0 0 0",
                          maxHeight: "220px", overflowY: "auto",
                          zIndex: 20, listStyle: "none", padding: "0.3rem",
                          boxShadow: "0 8px 24px rgba(0,0,0,0.7)"
                        }}>
                          <li
                            style={{ padding: "0.5rem 0.75rem", cursor: "pointer", borderRadius: "4px", fontSize: "0.8rem", color: "var(--text-muted)" }}
                            onMouseDown={(e) => { e.preventDefault(); handleSinglePlaylistChange(""); setPlaylistFilterSingle(""); setPlaylistFilterSingleOpen(false); }}
                          >
                            — Ninguna lista —
                          </li>
                          {playlists
                            .filter(pl => !playlistFilterSingle || pl.title.toLowerCase().includes(playlistFilterSingle.toLowerCase()))
                            .map(pl => (
                              <li
                                key={pl.id}
                                style={{
                                  padding: "0.5rem 0.75rem", cursor: "pointer", borderRadius: "4px", fontSize: "0.8rem",
                                  background: pl.id === updateForm.playlistId ? "rgba(168,85,247,0.15)" : "transparent",
                                  color: pl.id === updateForm.playlistId ? "#a855f7" : "var(--text-primary)"
                                }}
                                onMouseDown={(e) => { e.preventDefault(); handleSinglePlaylistChange(pl.id); setPlaylistFilterSingle(""); setPlaylistFilterSingleOpen(false); }}
                              >
                                {pl.title}
                              </li>
                            ))
                          }
                        </ul>
                      )}
                    </div>
                    {updateForm.playlistId && (
                      <div style={{ fontSize: "0.75rem", color: "#10b981", marginTop: "0.3rem" }}>
                        ✓ {playlists.find(pl => pl.id === updateForm.playlistId)?.title || updateForm.playlistId}
                      </div>
                    )}
                  </div>

                  {/* Sugerencia de fecha del subidor */}
                  {suggestedScheduledAt && (
                    <div style={{
                      background: "rgba(168, 85, 247, 0.08)",
                      border: "1px solid rgba(168, 85, 247, 0.25)",
                      borderRadius: "8px",
                      padding: "0.75rem 1rem",
                      marginTop: "1.5rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", fontWeight: "600", color: "#c084fc" }}>
                        <span>📅 Fecha sugerida por el subidor:</span>
                        <span style={{ color: "#fff", fontWeight: "700" }}>{formatDate(suggestedScheduledAt)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setUpdateForm(prev => ({
                            ...prev,
                            isScheduled: true,
                            scheduledAt: toLocalDateTimeString(suggestedScheduledAt)
                          }));
                        }}
                        style={{
                          alignSelf: "flex-start",
                          background: "linear-gradient(135deg, #a855f7 0%, #818cf8 100%)",
                          border: "none",
                          borderRadius: "6px",
                          color: "#fff",
                          fontSize: "0.7rem",
                          fontWeight: "700",
                          padding: "0.35rem 0.75rem",
                          cursor: "pointer",
                          transition: "all 0.2s"
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.filter = "brightness(1.1)"}
                        onMouseLeave={(e) => e.currentTarget.style.filter = "none"}
                      >
                        ✓ Usar sugerencia
                      </button>
                    </div>
                  )}

                  {/* Programación futura */}
                  <div className={styles.inputGroup} style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem", marginTop: "1rem" }}>
                    <input
                      type="checkbox"
                      id="schedToggle"
                      checked={updateForm.isScheduled}
                      onChange={(e) => setUpdateForm({ ...updateForm, isScheduled: e.target.checked })}
                    />
                    <label htmlFor="schedToggle" style={{ cursor: "pointer", fontSize: "0.85rem" }}>
                      Programar sincronización automática:
                    </label>
                  </div>

                  {updateForm.isScheduled && (
                    <div className={styles.inputGroup}>
                      <label>Fecha y Hora</label>
                      <DateTimePicker
                        required={updateForm.isScheduled}
                        value={updateForm.scheduledAt}
                        onChange={(e) => setUpdateForm({ ...updateForm, scheduledAt: e.target.value })}
                      />
                    </div>
                  )}

                  {updatingYoutubeVideo && (
                    <div style={{ margin: "1rem 0", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>
                        <span>{simpleUploadStatus}</span>
                        <span>{simpleUploadProgress}%</span>
                      </div>
                      <div style={{ width: "100%", height: "6px", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{ width: `${simpleUploadProgress}%`, height: "100%", background: "linear-gradient(90deg, #a855f7 0%, #ec4899 100%)", transition: "width 0.2s" }} />
                      </div>
                    </div>
                  )}

                  <div className={styles.inlineEditActions} style={{
                    marginTop: "1.5rem",
                    display: "flex",
                    gap: "0.75rem",
                    flexWrap: "wrap",
                    width: "100%"
                  }}>
                    <button
                      type="button"
                      onClick={handleCloseEditor}
                      className={styles.btnCancel}
                      style={{
                        flex: 1,
                        minWidth: "120px",
                        padding: "0.75rem 1.25rem",
                        borderRadius: "12px",
                        fontSize: "0.8rem",
                        fontWeight: "600",
                        letterSpacing: "0.03em",
                        textTransform: "uppercase"
                      }}
                    >Cancelar</button>

                    {updateForm.isScheduled ? (
                      <>
                        <button
                          type="button"
                          onClick={(e) => handleSaveVideo(e, 'public')}
                          disabled={updatingYoutubeVideo}
                          className={styles.btnSubmit}
                          style={{
                            flex: 1.5,
                            minWidth: "180px",
                            padding: "0.75rem 1.25rem",
                            borderRadius: "12px",
                            fontSize: "0.8rem",
                            fontWeight: "700",
                            letterSpacing: "0.03em",
                            textTransform: "uppercase",
                            color: "#fff",
                            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                            border: "1px solid rgba(16, 185, 129, 0.2)",
                            boxShadow: "0 4px 15px rgba(16, 185, 129, 0.25)",
                            cursor: "pointer",
                            transition: "all 0.2s"
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.transform = "translateY(-1px)";
                            e.currentTarget.style.boxShadow = "0 6px 20px rgba(16, 185, 129, 0.4)";
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.transform = "none";
                            e.currentTarget.style.boxShadow = "0 4px 15px rgba(16, 185, 129, 0.25)";
                          }}
                        >
                          {updatingYoutubeVideo ? "Programando..." : "⏰ Programar Público"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={(e) => handleSaveVideo(e, 'public')}
                          disabled={updatingYoutubeVideo}
                          className={styles.btnSubmit}
                          style={{
                            flex: 1.5,
                            minWidth: "180px",
                            padding: "0.75rem 1.25rem",
                            borderRadius: "12px",
                            fontSize: "0.8rem",
                            fontWeight: "700",
                            letterSpacing: "0.03em",
                            textTransform: "uppercase",
                            color: "#fff",
                            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                            border: "1px solid rgba(16, 185, 129, 0.2)",
                            boxShadow: "0 4px 15px rgba(16, 185, 129, 0.25)",
                            cursor: "pointer",
                            transition: "all 0.2s"
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.transform = "translateY(-1px)";
                            e.currentTarget.style.boxShadow = "0 6px 20px rgba(16, 185, 129, 0.4)";
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.transform = "none";
                            e.currentTarget.style.boxShadow = "0 4px 15px rgba(16, 185, 129, 0.25)";
                          }}
                        >
                          {updatingYoutubeVideo ? "Publicando..." : "📤 Público"}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleSaveVideo(e, 'private')}
                          disabled={updatingYoutubeVideo}
                          className={styles.btnSubmit}
                          style={{
                            flex: 1.5,
                            minWidth: "180px",
                            padding: "0.75rem 1.25rem",
                            borderRadius: "12px",
                            fontSize: "0.8rem",
                            fontWeight: "700",
                            letterSpacing: "0.03em",
                            textTransform: "uppercase",
                            color: "#fff",
                            background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
                            border: "1px solid rgba(59, 130, 246, 0.2)",
                            boxShadow: "0 4px 15px rgba(59, 130, 246, 0.25)",
                            cursor: "pointer",
                            transition: "all 0.2s"
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.transform = "translateY(-1px)";
                            e.currentTarget.style.boxShadow = "0 6px 20px rgba(59, 130, 246, 0.4)";
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.transform = "none";
                            e.currentTarget.style.boxShadow = "0 4px 15px rgba(59, 130, 246, 0.25)";
                          }}
                        >
                          {updatingYoutubeVideo ? "Publicando..." : "🔒 Privado"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* Actualizaciones locales programadas activas */}
          {scheduledUpdates.length > 0 && (
            <div className={styles.card} style={{ marginTop: "1.5rem" }}>
              <div className={styles.cardTitle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Proceso de Subida</span>
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
                        {/* Botón individual solo si tiene fecha programada y no está subiendo */}
                        {update.scheduledAt && update.status !== "UPLOADING" && (
                          <button
                            type="button"
                            title="Publicar este vídeo ahora, sin esperar a la hora programada"
                            onClick={async () => {
                              if (!confirm(`¿Publicar "${update.title || "este vídeo"}" ahora en YouTube, sin esperar a la hora programada?`)) return;
                              setExecutingScheduler(true);
                              try {
                                const res = await fetch(`/api/scheduler?videoId=${update.id}`, { cache: "no-store" });
                                if (res.ok) {
                                  await fetchScheduledUpdates();
                                  await fetchTasks();
                                } else {
                                  const data = await res.json();
                                  alert(`Error: ${data.error || "error desconocido"}`);
                                }
                              } catch (err) {
                                alert("Error de red al intentar publicar.");
                              } finally {
                                setExecutingScheduler(false);
                              }
                            }}
                            disabled={executingScheduler}
                            style={{
                              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                              border: "none",
                              color: "#fff",
                              borderRadius: "6px",
                              padding: "2px 9px",
                              fontSize: "0.68rem",
                              fontWeight: "700",
                              cursor: executingScheduler ? "not-allowed" : "pointer",
                              opacity: executingScheduler ? 0.6 : 1,
                              whiteSpace: "nowrap"
                            }}
                          >
                            ▶ Publicar ahora
                          </button>
                        )}
                          <button
                            type="button"
                            title="Cancelar programación"
                            onClick={async () => {
                              const isUploading = update.status === "UPLOADING";
                              const msg = isUploading 
                                ? `⚠️ ¿Cancelar y eliminar esta subida activa de "${update.title || "video"}"? Si la subida está en curso en el navegador del subidor, se cancelará.`
                                : `¿Cancelar la sincronización programada de "${update.title || update.youtubeId}"?`;
                              if (!confirm(msg)) return;
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
                        const isDraftUpload = update.status === "UPLOADING" && !update.youtubeId;
                        const isPub = update.privacyStatus === 'public';
                        return (
                          <span style={{
                            color: isDraftUpload ? '#38bdf8' : (isPub ? '#34d399' : '#f87171'),
                            background: isDraftUpload ? 'rgba(56, 189, 248, 0.15)' : (isPub ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)'),
                            padding: '1px 6px',
                            borderRadius: '8px',
                            fontSize: '0.7rem',
                            fontWeight: 'bold'
                          }}>
                            {isDraftUpload ? 'Borrador' : (isPub ? 'Público' : 'Privado')}
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


          {/* Cola 3: Historial de publicaciones */}
          <div className={styles.bottomGrid}>
            <div className={styles.card} style={{ marginTop: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
                <div>
                  <div style={{ fontSize: "0.68rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em", color: "#34d399", marginBottom: "0.25rem" }}>Editor</div>
                  <h3 style={{ fontSize: "1rem", fontWeight: "700", color: "#f8fafc", margin: 0 }}>Historial de publicaciones</h3>
                  <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.2rem 0 0 0" }}>Vídeos completados y publicados en YouTube.</p>
                </div>
                <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "#34d399", background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.25)", padding: "3px 12px", borderRadius: "20px", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {mergedCompletedItems.length} publicado{mergedCompletedItems.length !== 1 ? "s" : ""}
                </span>
              </div>

              {loadingTasks ? (
                <div className={styles.emptyState}>Cargando tareas...</div>
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
                        <div style={{ marginTop: "0.4rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: "500" }}>Estado en YouTube:</span>
                          {(() => {
                            const ytVid = privateVideos.find(v => v.id === item.youtubeId);
                            const ps = ytVid ? ytVid.privacyStatus : item.privacyStatus;
                            
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
                              <span style={{ fontSize: "0.72rem", fontWeight: "800", color: "#34d399", background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.3)", padding: "2px 10px", borderRadius: "6px" }}>
                                Público
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <a
                          href={`https://studio.youtube.com/video/${item.youtubeId}/edit`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.btnSubmit}
                          style={{
                            width: "auto",
                            fontSize: "0.72rem",
                            padding: "0.35rem 0.8rem",
                            background: "#0284c7",
                            border: "none",
                            textDecoration: "none",
                            color: "#fff",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            borderRadius: "6px",
                            fontWeight: "600",
                            height: "fit-content"
                          }}
                        >
                          ✏️ Studio
                        </a>
                        <button
                          type="button"
                          onClick={() => handleOpenHistoryThumbnailModal(item)}
                          className={styles.btnSubmit}
                          style={{
                            width: "auto",
                            fontSize: "0.72rem",
                            padding: "0.35rem 0.8rem",
                            background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                            border: "none",
                            color: "#fff",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            borderRadius: "6px",
                            fontWeight: "600",
                            height: "fit-content"
                          }}
                        >
                          🎨 Miniatura
                        </button>
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}



      {/* Modal de Catálogo de Logotipos */}
      {showLogosManager && (
        <div className={styles.settingsOverlay}>
          <div className={styles.settingsModal} style={{ maxWidth: "550px" }}>
            <div className={styles.settingsHeader}>
              <h2 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                🎨 Catálogo de Logotipos
              </h2>
              <button type="button" onClick={() => setShowLogosManager(false)} className={styles.closeBtn}>✕</button>
            </div>

            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
              Sube logotipos de programas en formato PNG transparentes. Se usarán de fondo o superposición en las portadas de los vídeos.
            </p>

            {/* Subir nuevo logo */}
            <div style={{ marginBottom: "1.5rem", padding: "1rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid var(--border-color, #334155)" }}>
              <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
                <label
                  className={styles.btnSubmit}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.8rem",
                    cursor: logoUploadProgress !== null ? "not-allowed" : "pointer",
                    opacity: logoUploadProgress !== null ? 0.6 : 1,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    width: "auto",
                    margin: 0,
                    background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                    color: "#fff"
                  }}
                >
                  {logoUploadProgress !== null ? "Subiendo..." : "📤 Subir Nuevo Logotipo (PNG)"}
                  <input
                    type="file"
                    accept="image/png"
                    disabled={logoUploadProgress !== null}
                    onChange={async (e) => {
                      const file = e.target.files[0];
                      if (file) {
                        uploadLogoWithProgress(
                          file,
                          async (data) => {
                            await fetchProgramLogosCatalog();
                          },
                          (err) => {
                            alert("Error subiendo logotipo: " + err.message);
                          }
                        );
                      }
                    }}
                    style={{ display: "none" }}
                  />
                </label>

                {logoUploadProgress !== null && (
                  <div style={{ flex: 1, minWidth: "150px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                      <span>Subiendo archivo...</span>
                      <span>{logoUploadProgress}%</span>
                    </div>
                    <div className={styles.batchSyncProgressOuter} style={{ height: "6px", marginTop: 0 }}>
                      <div
                        className={styles.batchSyncProgressInner}
                        style={{
                          width: `${logoUploadProgress}%`,
                          background: "linear-gradient(90deg, #a855f7 0%, #ec4899 100%)",
                          boxShadow: "0 0 8px rgba(168, 85, 247, 0.4)"
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Listado de logotipos existentes */}
            <h3 style={{ fontSize: "0.9rem", fontWeight: "600", marginBottom: "0.5rem" }}>Logotipos Registrados ({programLogosCatalog.length})</h3>
            <div style={{ maxHeight: "250px", overflowY: "auto", display: "grid", gridTemplateColumns: "1fr", gap: "0.5rem", padding: "0.25rem" }}>
              {programLogosCatalog.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", textAlign: "center", padding: "1rem" }}>
                  No hay logotipos registrados en el catálogo.
                </div>
              ) : (
                programLogosCatalog.map(logo => {
                  const logoName = typeof logo === "string" ? logo : logo.name;
                  const logoPlaylistId = typeof logo === "string" ? null : logo.playlistId;
                  return (
                    <div key={logoName} style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0.5rem",
                      background: "var(--bg-card, #0f172a)",
                      border: "1px solid var(--border-color, #334155)",
                      borderRadius: "8px",
                      gap: "0.5rem"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0, flex: 1 }}>
                        <img src={`/program_logos/${logoName}`} alt="" style={{ width: "32px", height: "32px", objectFit: "contain", borderRadius: "4px", background: "rgba(255,255,255,0.05)" }} />
                        <span style={{ fontSize: "0.75rem", fontWeight: "600", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                          {logoName.replace(/\.[^/.]+$/, "").replace(/_/g, " ")}
                        </span>
                      </div>
                      
                      {/* Vinculación de Playlist */}
                      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        <select
                          value={logoPlaylistId || ""}
                          onChange={async (e) => {
                            const val = e.target.value;
                            try {
                              const res = await fetch("/api/program-logos", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ filename: logoName, playlistId: val || null }),
                              });
                              if (res.ok) {
                                await fetchProgramLogosCatalog();
                              } else {
                                const data = await res.json();
                                alert("Error al vincular playlist: " + (data.error || "error desconocido"));
                              }
                            } catch (err) {
                              console.error(logoName, err);
                              alert("Error de red al vincular playlist");
                            }
                          }}
                          style={{
                            padding: "0.25rem 0.5rem",
                            background: "var(--bg-surface-secondary, #1e293b)",
                            border: "1px solid var(--border-color, #334155)",
                            borderRadius: "6px",
                            color: "#fff",
                            fontSize: "0.7rem",
                            maxWidth: "180px"
                          }}
                        >
                          <option value="">-- Sin Playlist --</option>
                          {playlists.map(pl => (
                            <option key={pl.id} value={pl.id}>
                              {pl.title}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        aria-label={`Eliminar ${logoName}`}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#ef4444",
                          cursor: "pointer",
                          fontSize: "0.85rem",
                          padding: "0.25rem"
                        }}
                        onClick={async () => {
                          if (!confirm(`¿Eliminar el logotipo "${logoName}"?`)) return;
                          try {
                            const res = await fetch("/api/program-logos", {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ filename: logoName }),
                            });
                            if (res.ok) {
                              await fetchProgramLogosCatalog();
                            } else {
                              const data = await res.json();
                              alert("Error al eliminar logotipo: " + (data.error || "error desconocido"));
                            }
                          } catch (err) {
                            console.error("Error al eliminar logotipo:", err);
                            alert("Error de red o de cliente: " + err.message);
                          }
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Overlay de Sincronización en Lote */}
      {isSyncingBatch && (
        <div className={styles.batchSyncOverlay}>
          <div className={styles.batchSyncModal}>
            <div className={styles.batchSyncSpinner} />
            <h3 style={{ fontSize: "1.25rem", fontWeight: "800", color: "#f8fafc", margin: 0 }}>
              Sincronizando Videos en Lote
            </h3>
            <p style={{ fontSize: "0.9rem", color: "#94a3b8", margin: 0 }}>
              {syncProgress.status}
            </p>
            <div style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#64748b", marginBottom: "0.25rem" }}>
                <span>Progreso</span>
                <span>{syncProgress.current} de {syncProgress.total}</span>
              </div>
              <div className={styles.batchSyncProgressOuter}>
                <div
                  className={styles.batchSyncProgressInner}
                  style={{ width: `${syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Elemento de vídeo oculto para extracción de miniaturas */}
      <video
        ref={hiddenVideoRef}
        crossOrigin="anonymous"
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

      {/* Modal para regenerar miniatura desde el historial */}
      {showHistoryThumbnailModal && historyModalItem && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          padding: "1rem"
        }}>
          <div style={{
            background: "rgba(30, 41, 59, 0.95)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "16px",
            width: "100%",
            maxWidth: "960px",
            maxHeight: "90vh",
            overflowY: "auto",
            padding: "2rem",
            boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)",
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr",
            gap: "2rem",
            position: "relative"
          }}>
            {/* Botón de cerrar */}
            <button
              onClick={() => setShowHistoryThumbnailModal(false)}
              style={{
                position: "absolute",
                top: "1rem",
                right: "1.25rem",
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                fontSize: "1.5rem",
                cursor: "pointer"
              }}
            >
              ✕
            </button>

            {/* Columna Izquierda: Vista previa y Fotogramas */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <h3 style={{ fontSize: "1.2rem", fontWeight: "800", color: "#fff", margin: 0 }}>
                Diseño de Miniatura
              </h3>
              
              {/* Previsualización del canvas */}
              <div style={{
                position: "relative",
                aspectRatio: "16/9",
                borderRadius: "12px",
                overflow: "hidden",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                background: "#090d1f"
              }}>
                {historyModalGeneratedBase64 ? (
                  <img
                    src={historyModalGeneratedBase64}
                    alt="Preview miniatura"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    Generando preview...
                  </div>
                )}
                {/* Overlay de carga IA */}
                {historyModalIsGeneratingSeo && (
                  <div style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: "rgba(9, 13, 31, 0.8)",
                    backdropFilter: "blur(4px)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.75rem",
                    zIndex: 10
                  }}>
                    <div className={styles.batchSyncSpinner} style={{ width: "35px", height: "35px", borderTopColor: "#a855f7" }} />
                    <span style={{ fontSize: "0.85rem", color: "#f8fafc", fontWeight: "500" }}>Generando frase SEO con IA...</span>
                  </div>
                )}
              </div>

              {/* Selector de fondo/fotogramas */}
              <div style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: "12px",
                padding: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem"
              }}>
                <span style={{ fontSize: "0.8rem", fontWeight: "700", color: "#f8fafc" }}>
                  🖼️ Fotograma de fondo:
                </span>
                
                {historyModalIsExtracting && (
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textAlign: "center", padding: "0.5rem" }}>
                    ⏳ Extrayendo fotogramas del vídeo local...
                  </div>
                )}
                
                {!historyModalIsExtracting && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(85px, 1fr))", gap: "0.4rem" }}>
                    {/* Opción 1: Miniatura actual de YouTube */}
                    {historyModalCustomBg && (
                      <div
                        onClick={() => setHistoryModalCustomBg(historyModalCustomBg)}
                        style={{
                          cursor: "pointer",
                          borderRadius: "6px",
                          overflow: "hidden",
                          border: `2px solid ${historyModalCustomBg ? "#a855f7" : "transparent"}`,
                          aspectRatio: "16/9",
                          position: "relative"
                        }}
                      >
                        <img src={historyModalCustomBg} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        <span style={{
                          position: "absolute", bottom: 0, left: 0, right: 0,
                          fontSize: "8px", background: "rgba(0,0,0,0.7)", color: "#fff",
                          textAlign: "center", padding: "1px 0"
                        }}>YouTube</span>
                      </div>
                    )}
                    
                    {/* Fotogramas locales */}
                    {historyModalCapturedFrames.map((frame, idx) => {
                      const isSelected = historyModalCustomBg === frame;
                      return (
                        <div
                          key={idx}
                          onClick={() => setHistoryModalCustomBg(frame)}
                          style={{
                            cursor: "pointer",
                            borderRadius: "6px",
                            overflow: "hidden",
                            border: `2px solid ${isSelected ? "#a855f7" : "transparent"}`,
                            aspectRatio: "16/9"
                          }}
                        >
                          <img src={frame} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                      );
                    })}
                  </div>
                )}
                
                 {/* Subida manual */}
                 <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                   <div>
                     <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "block" }}>Subir fondo personalizado (imagen):</label>
                     <input
                       type="file"
                       accept="image/*"
                       onChange={handleHistoryModalNewBgSelect}
                       style={{ fontSize: "0.72rem", background: "transparent", border: "none", color: "#cbd5e1" }}
                     />
                   </div>
                   {historyModalCapturedFrames.length === 0 && !historyModalIsExtracting && (
                     <div>
                       <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "block" }}>O cargar vídeo local para extraer fotogramas:</label>
                       <input
                         type="file"
                         accept="video/*"
                         style={{ fontSize: "0.72rem", background: "transparent", border: "none", color: "#cbd5e1" }}
                         onChange={(e) => {
                           const file = e.target.files[0];
                           if (file) {
                             const url = URL.createObjectURL(file);
                             setHistoryModalStatus("Cargando archivo de vídeo local...");
                             setHistoryModalIsExtracting(true);
                             if (historyModalVideoRef.current) {
                               historyModalVideoRef.current.src = url;
                               historyModalVideoRef.current.load();
                             }
                           }
                         }}
                       />
                     </div>
                   )}
                 </div>
              </div>
            </div>

            {/* Columna Derecha: Edición de campos y guardado */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", justifyContent: "space-between" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <h3 style={{ fontSize: "1.2rem", fontWeight: "800", color: "#fff", margin: 0 }}>
                  Ajustes de Portada
                </h3>
                
                {/* Texto Frase SEO */}
                <div className={styles.inputGroup} style={{ margin: 0 }}>
                  <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Frase SEO en miniatura (3-5 palabras)</span>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <button
                        type="button"
                        disabled={historyModalIsGeneratingSeo}
                        onClick={async () => {
                          if (!historyModalItem.title) {
                            alert("El vídeo no tiene título para generar la frase SEO.");
                            return;
                          }
                          setHistoryModalIsGeneratingSeo(true);
                          try {
                            const res = await fetch("/api/youtube/generate-seo-phrase", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ title: historyModalItem.title, description: historyModalItem.description || "" })
                            });
                            if (res.ok) {
                              const data = await res.json();
                              if (data.thumbnailText) {
                                // Eliminar emojis de la frase SEO generada
                                const cleanPhrase = data.thumbnailText.replace(/[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/gu, "");
                                setHistoryModalText(cleanPhrase);
                              }
                            } else {
                              alert("Error al generar la frase SEO.");
                            }
                          } catch (err) {
                            console.error(err);
                            alert("Error de red al conectar con Gemini.");
                          } finally {
                            setHistoryModalIsGeneratingSeo(false);
                          }
                        }}
                        className={styles.btnSubmit}
                        style={{
                          width: "auto",
                          margin: 0,
                          padding: "0.2rem 0.5rem",
                          fontSize: "0.65rem",
                          borderRadius: "4px",
                          background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                          color: "#fff",
                          border: "none",
                          cursor: "pointer"
                        }}
                      >
                        {historyModalIsGeneratingSeo ? "Generando..." : "Generar con IA"}
                      </button>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                        {historyModalText.trim().split(/\s+/).filter(Boolean).length}/5 palabras
                      </span>
                    </div>
                  </label>
                  <input
                    type="text"
                    value={historyModalText}
                    onChange={(e) => {
                      // Eliminar cualquier emoji introducido a mano en tiempo real
                      const val = e.target.value.replace(/[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/gu, "");
                      setHistoryModalText(val);
                    }}
                    required
                  />
                </div>

                {/* Logotipo del programa */}
                <div className={styles.inputGroup} style={{ margin: 0 }}>
                  <label>Logotipo del Programa</label>
                  <select
                    value={historyModalLogo}
                    onChange={(e) => setHistoryModalLogo(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      background: "rgba(15, 23, 42, 0.4)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      color: "#fff"
                    }}
                  >
                    <option value="none">Ninguno (solo logo TVG)</option>
                    {programLogosCatalog.map((logo) => {
                      const logoName = typeof logo === "string" ? logo : logo.name;
                      return (
                        <option key={logoName} value={logoName}>
                          {logoName.replace(/_/g, " ").replace(/\.[^/.]+$/, "")}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Estado */}
                <div style={{
                  background: "rgba(0, 0, 0, 0.2)",
                  padding: "0.75rem",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.03)",
                  fontSize: "0.75rem",
                  color: "#cbd5e1"
                }}>
                  <strong>Estado:</strong> {historyModalStatus}
                </div>
              </div>

              {/* Botón de actualizar */}
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  onClick={() => setShowHistoryThumbnailModal(false)}
                  style={{
                    flex: 1,
                    padding: "0.75rem",
                    borderRadius: "10px",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border-color)",
                    color: "#f1f5f9",
                    cursor: "pointer",
                    fontWeight: "600"
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={historyModalIsSaving || historyModalIsExtracting}
                  onClick={handleSaveHistoryThumbnail}
                  style={{
                    flex: 1.5,
                    padding: "0.75rem",
                    borderRadius: "10px",
                    background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                    border: "none",
                    color: "#fff",
                    cursor: (historyModalIsSaving || historyModalIsExtracting) ? "not-allowed" : "pointer",
                    fontWeight: "700",
                    boxShadow: "0 4px 15px rgba(168, 85, 247, 0.3)"
                  }}
                >
                  {historyModalIsSaving ? "Subiendo..." : "Guardar y Subir 📤"}
                </button>
              </div>
            </div>
          </div>
          
          {/* Elemento de vídeo oculto del modal */}
          <video
            ref={historyModalVideoRef}
            crossOrigin="anonymous"
            style={{ display: "none" }}
            preload="auto"
            muted
            playsInline
            onLoadedMetadata={handleHistoryVideoLoadedMetadata}
            onSeeked={handleHistoryVideoSeeked}
          />
        </div>
      )}
    </div>
    </div>
  );
}
