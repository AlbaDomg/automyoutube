"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import styles from "./page.module.css";

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
  } catch (e) {}
  const cleanIdPattern = /^([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(cleanIdPattern);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

export default function Dashboard() {
  // Estado del canal
  const [channel, setChannel] = useState({ connected: false, channel: null });
  const [loadingChannel, setLoadingChannel] = useState(true);

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

  // Selección de Video, Carga de PDF e Índice
  const [youtubeId, setYoutubeId] = useState("");
  const [pdfFile, setPdfFile] = useState(null);
  const [savedPdfName, setSavedPdfName] = useState("");
  const [videoIndex, setVideoIndex] = useState(1);
  const [isAnalyzingPdf, setIsAnalyzingPdf] = useState(false);
  const [autoIncrement, setAutoIncrement] = useState(true);

  // Estado de edición/actualización de YouTube
  const [selectedYoutubeVideo, setSelectedYoutubeVideo] = useState(null);
  const [updateForm, setUpdateForm] = useState({
    title: "",
    description: "",
    tags: "",
    isScheduled: false,
    scheduledAt: ""
  });
  const [updatingYoutubeVideo, setUpdatingYoutubeVideo] = useState(false);
  const [loadingYoutubeVideo, setLoadingYoutubeVideo] = useState(false);

  // Sugerencias de la IA (Títulos/Miniatura)
  const [optimizationSuggestions, setOptimizationSuggestions] = useState(null);
  const [isGeneratingSeoPhrase, setIsGeneratingSeoPhrase] = useState(false);

  // Estado de la cola de actualizaciones programadas locales
  const [scheduledUpdates, setScheduledUpdates] = useState([]);

  // Listado de tareas (VideoTask)
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  // Estados del generador de miniaturas (Estilo TVG)
  const [thumbnailText, setThumbnailText] = useState("");
  const [programLogosCatalog, setProgramLogosCatalog] = useState([]);
  const [selectedProgramLogo, setSelectedProgramLogo] = useState("default");
  const [customBgBase64, setCustomBgBase64] = useState(null);
const [logoDropdownOpen, setLogoDropdownOpen] = useState(false);
  const [isAutoThumbnailEnabled, setIsAutoThumbnailEnabled] = useState(false);
  const [newThumbnailBase64, setNewThumbnailBase64] = useState(null);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);

  const canvasRef = useRef(null);
  const templateImageRef = useRef(null);
  const defaultProgramLogoCanvasRef = useRef(null);
  const pdfInputRef = useRef(null);

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

  // Restablecer estados del generador de miniatura
  const handleResetThumbnailStates = () => {
    setThumbnailText("");
    setSelectedProgramLogo("default");
    setCustomBgBase64(null);
    setIsAutoThumbnailEnabled(false);
    setNewThumbnailBase64(null);
  };

  // Precargar plantilla original de TVG ("Hora Galega")
  useEffect(() => {
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
          // Volver transparente el fondo blanco del logotipo
          if (r > 240 && g > 240 && b > 240) {
            progData[i + 3] = 0;
          }
        }
        progCtx.putImageData(progImgData, 0, 0);
        defaultProgramLogoCanvasRef.current = progCanvas;
        console.log("[Thumbnail Generator] Logotipo por defecto procesado.");
      } catch (err) {
        console.error("[Thumbnail Generator] Error procesando plantilla:", err);
      }
    };
  }, []);

  const fetchProgramLogosCatalog = async () => {
    try {
      const res = await fetch("/api/program-logos", { cache: "no-store" });
      const data = await res.json();
      if (data.logos) {
        setProgramLogosCatalog(data.logos);
      }
    } catch (err) {
      console.error("Error fetching program logos catalog:", err);
    }
  };

  // Cargar catálogo de logotipos al cargar la página
  useEffect(() => {
    fetchProgramLogosCatalog();
  }, []);

  // Cargar preferencia de logotipo persistida en localStorage al seleccionar un vídeo
  useEffect(() => {
    if (selectedYoutubeVideo) {
      const cleanId = extractYoutubeId(selectedYoutubeVideo.id || selectedYoutubeVideo.youtubeId);
      if (cleanId) {
        const saved = localStorage.getItem(`prog_logo_${cleanId}`);
        setSelectedProgramLogo(saved || "default");
      } else {
        setSelectedProgramLogo("default");
      }
    }
  }, [selectedYoutubeVideo]);

  // Persistir la selección de logotipo en localStorage ante cambios
  useEffect(() => {
    if (selectedYoutubeVideo && selectedProgramLogo) {
      const cleanId = extractYoutubeId(selectedYoutubeVideo.id || selectedYoutubeVideo.youtubeId);
      if (cleanId) {
        localStorage.setItem(`prog_logo_${cleanId}`, selectedProgramLogo);
      }
    }
  }, [selectedProgramLogo, selectedYoutubeVideo]);

  // Dibujar y componer la miniatura estilo TVG en el canvas
  const generateAutoThumbnail = async () => {
    if (!isAutoThumbnailEnabled || !selectedYoutubeVideo) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsGeneratingThumbnail(true);
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Contexto 2D no disponible");

      canvas.width = 1280;
      canvas.height = 720;

      // 1. Dibujar Imagen de Fondo
      let bgImg = null;
      if (customBgBase64) {
        bgImg = await loadImage(customBgBase64);
      } else if (selectedYoutubeVideo.thumbnail) {
        const proxiedUrl = `/api/youtube/thumbnail-proxy?url=${encodeURIComponent(selectedYoutubeVideo.thumbnail)}`;
        bgImg = await loadImage(proxiedUrl);
      }

      if (bgImg) {
        const canvasRatio = canvas.width / canvas.height;
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
        ctx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      } else {
        const grad = ctx.createLinearGradient(0, 0, 1280, 720);
        grad.addColorStop(0, "#1e1b4b");
        grad.addColorStop(1, "#311042");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1280, 720);
      }

      // 2. Logotipo de la cadena (esquina superior derecha en corte diagonal usando /tvg_logo.png)
      try {
        const tvgLogoImg = await loadImage("/tvg_logo.png");
        const lw = tvgLogoImg.width;
        const lh = tvgLogoImg.height;

        // Crear lienzo temporal para aplicar la máscara de transparencia
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = lw;
        tempCanvas.height = lh;
        const tempCtx = tempCanvas.getContext("2d");
        if (tempCtx) {
          tempCtx.drawImage(tvgLogoImg, 0, 0);
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
        }

        // Dibujar el logotipo de la cadena en la esquina superior derecha con sombra paralela
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = -4;
        ctx.shadowOffsetY = 4;
        
        // Dibujamos el logotipo TVG enmascarado
        // Ancho y alto de 192px en la esquina para que coincida perfectamente con la diagonal 1110px a 1280px y alto 170px
        ctx.drawImage(tempCanvas, 1280 - 192, 0, 192, 192);
        ctx.restore();
      } catch (err) {
        console.error("[Thumbnail Generator] Error cargando o procesando tvg_logo.png:", err);
      }

      // 3. Logotipo del programa (esquina superior izquierda)
      let progImg = null;
      if (selectedProgramLogo === "none") {
        // No dibujar logotipo de programa
      } else if (selectedProgramLogo === "default") {
        if (defaultProgramLogoCanvasRef.current) {
          progImg = defaultProgramLogoCanvasRef.current;
        }
      } else if (selectedProgramLogo) {
        try {
          progImg = await loadImage(`/program_logos/${selectedProgramLogo}`);
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

      // 4. Frase SEO en Gallego abajo a la izquierda (máx 4 palabras)
      if (thumbnailText) {
        const words = thumbnailText.trim().toUpperCase().split(/\s+/);
        // Dividir estrictamente en 2 palabras para el título (arriba, blanco) y las restantes/2 para el subtítulo (abajo, naranja)
        const line1 = words.slice(0, 2).join(" ");
        const line2 = words.slice(2).join(" ");

        ctx.save();
        ctx.font = "bold 86px Impact, Arial Black, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";

        ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
        ctx.shadowBlur = 15;
        ctx.shadowOffsetX = 5;
        ctx.shadowOffsetY = 5;

        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 14;
        ctx.lineJoin = "round";

        const textX = 60;
        const line2Y = 720 - 65;
        const line1Y = line2Y - 95;

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

      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      setNewThumbnailBase64(dataUrl);
    } catch (err) {
      console.error("[Thumbnail Generator] Error renderizando canvas:", err);
    } finally {
      setIsGeneratingThumbnail(false);
    }
  };

  // Renderizar miniatura automáticamente ante cambios
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
    fetchConfig();
    fetchChannel();
    fetchTasks();
    fetchScheduledUpdates();
  }, []);

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
    const interval = setInterval(() => {
      fetchScheduledUpdates();
      fetchTasks(true);
    }, 10000);
    return () => clearInterval(interval);
  }, []);



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

  const fetchChannel = async () => {
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
        const data = await res.json();
        setScheduledUpdates(data.filter(v => v.status === "SCHEDULED" || v.status === "UPLOADING"));
      }
    } catch (err) {
      console.error("Error al obtener cola de actualizaciones programadas:", err);
    }
  };

  // Buscar un video específico en YouTube por ID
  const fetchYoutubeVideoById = async (id) => {
    const cleanId = extractYoutubeId(id);
    if (!cleanId) return;
    setYoutubeId(cleanId);
    setLoadingYoutubeVideo(true);
    try {
      const res = await fetch(`/api/youtube/videos?q=${encodeURIComponent(cleanId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.length > 0) {
          handleSelectVideo(data[0]);
        } else {
          alert("No se encontró el video con ese ID en tu canal de YouTube.");
        }
      } else {
        alert("Fallo al buscar el video.");
      }
    } catch (err) {
      console.error("Error al buscar video:", err);
      alert("Error de red al consultar el video.");
    } finally {
      setLoadingYoutubeVideo(false);
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

  // Seleccionar video e inicializar formulario
  const handleSelectVideo = (video) => {
    setSelectedYoutubeVideo(video);
    setYoutubeId(video.id);
    
    // Buscar si ya hay una actualización programada para este video
    const scheduledUpdate = scheduledUpdates.find(u => u.youtubeId === video.id);
    
    setUpdateForm({
      title: video.title || "",
      description: video.description || "",
      tags: video.tags || "",
      isScheduled: !!scheduledUpdate,
      scheduledAt: scheduledUpdate && scheduledUpdate.scheduledAt 
        ? toLocalDateTimeString(scheduledUpdate.scheduledAt) 
        : ""
    });
    setOptimizationSuggestions(null);
    handleResetThumbnailStates();
  };

  // Cargar una tarea pendiente en el editor
  const handleWorkOnTask = async (task) => {
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
        
        setUpdateForm({
          title: task.title || video.title || "",
          description: task.description || video.description || "",
          tags: video.tags || "",
          isScheduled: !!scheduledUpdate,
          scheduledAt: scheduledUpdate && scheduledUpdate.scheduledAt 
            ? toLocalDateTimeString(scheduledUpdate.scheduledAt) 
            : ""
        });
        setOptimizationSuggestions(null);
        handleResetThumbnailStates();
        
        // Cargar miniatura automática con la frase SEO guardada o el fallback por defecto
        setThumbnailText(task.thumbnailText || (task.title ? task.title.split(/\s+/).slice(0, 4).join(" ") : ""));
        setIsAutoThumbnailEnabled(true);
      } else {
        alert("No se encontró el video de la tarea en YouTube.");
      }
    } catch (err) {
      alert("Error al cargar el video: " + err.message);
    } finally {
      setLoadingYoutubeVideo(false);
    }
  };

  // Analizar el PDF con Gemini e iniciar tarea PENDIENTE_SINCRONIZACION
  const handleAnalyzePdf = async (e) => {
    e.preventDefault();
    const cleanYoutubeId = extractYoutubeId(youtubeId);
    if (!pdfFile && !savedPdfName) {
      alert("Por favor, sube un archivo PDF de referencia.");
      return;
    }
    if (!cleanYoutubeId) {
      alert("Por favor, introduce o selecciona un ID de video de YouTube.");
      return;
    }
    setYoutubeId(cleanYoutubeId);

    setIsAnalyzingPdf(true);
    try {
      // 1. Intentar buscar el video en YouTube primero de forma segura para obtener info básica
      let videoInfo = null;
      try {
        const ytRes = await fetch(`/api/youtube/videos?q=${encodeURIComponent(cleanYoutubeId)}`);
        if (ytRes.ok) {
          const ytData = await ytRes.json();
          if (ytData && ytData.length > 0) {
            videoInfo = ytData[0];
          }
        }
      } catch (ytErr) {
        console.warn("YouTube video check failed:", ytErr.message);
      }

      // 2. Analizar el PDF
      const formData = new FormData();
      if (pdfFile) {
        formData.append("file", pdfFile);
      }
      formData.append("youtubeVideoId", cleanYoutubeId);
      formData.append("videoIndex", videoIndex.toString());

      const res = await fetch("/api/youtube/analyze-pdf", {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fallo al procesar el documento");
      }

      const data = await res.json();
      alert("¡Documento analizado con éxito! Datos volcados de forma literal en el editor en estado 'Pendiente de Sincronización'.");
      
      if (data.activePdfName) {
        setSavedPdfName(data.activePdfName);
      }

      // Establecer video seleccionado y abrir el editor (fallback si no se recuperó información de YouTube)
      const finalVideoInfo = videoInfo || {
        id: cleanYoutubeId,
        title: `Video (${cleanYoutubeId})`,
        description: "",
        tags: "",
        thumbnail: ""
      };
      setSelectedYoutubeVideo(finalVideoInfo);

      const scheduledUpdate = scheduledUpdates.find(u => u.youtubeId === finalVideoInfo.id);

      // Rellenar editor con la transcripción/metadatos sugeridos (Títulos/Descripciones literales)
      setUpdateForm({
        title: data.suggestions.titles[0] || finalVideoInfo.title || "",
        description: data.suggestions.description || finalVideoInfo.description || "",
        tags: data.suggestions.tags.join(', ') || finalVideoInfo.tags || "",
        isScheduled: !!scheduledUpdate,
        scheduledAt: scheduledUpdate && scheduledUpdate.scheduledAt 
          ? toLocalDateTimeString(scheduledUpdate.scheduledAt) 
          : ""
      });

      setOptimizationSuggestions(data.suggestions);

      if (data.suggestions.thumbnailText) {
        setThumbnailText(data.suggestions.thumbnailText);
        setIsAutoThumbnailEnabled(true);
      } else {
        handleResetThumbnailStates();
      }

      // Actualizar listado de tareas pendientes
      fetchTasks();

      // Autoincrementar si la opción está activada
      if (autoIncrement) {
        setVideoIndex((prev) => Math.min(prev + 1, 10));
      }
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setIsAnalyzingPdf(false);
    }
  };

  // Guardar cambios en YouTube y marcar tarea como completada (realizada)
  const handleSaveYoutubeVideoChanges = async (e) => {
    e.preventDefault();
    if (!selectedYoutubeVideo) return;
    setUpdatingYoutubeVideo(true);
    try {
      const res = await fetch("/api/youtube/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeVideoId: selectedYoutubeVideo.id,
          title: updateForm.title,
          description: updateForm.description,
          tags: updateForm.tags,
          thumbnail: newThumbnailBase64,
          scheduledAt: updateForm.isScheduled ? updateForm.scheduledAt : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fallo al guardar los cambios");
      }

      const responseData = await res.json();
      if (responseData.scheduled) {
        alert("¡Actualización de video programada con éxito!");
      } else {
        if (responseData.thumbnailError) {
          alert(`¡Video actualizado en YouTube con éxito, pero la miniatura no se pudo subir!\n\nDetalle: ${responseData.thumbnailError}\n\nNota: Asegúrate de que tu canal esté verificado con número de teléfono en YouTube para permitir la subida de miniaturas personalizadas.`);
        } else {
          alert("¡Video sincronizado y actualizado en YouTube con éxito!");
        }
      }

      setSelectedYoutubeVideo(null);
      setOptimizationSuggestions(null);
      setYoutubeId("");
      setPdfFile(null);
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
    });
  };

  const toLocalDateTimeString = (date) => {
    if (!date) return "";
    const d = new Date(date);
    const pad = (n) => n.toString().padStart(2, '0');
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <h1>AutomYouTube</h1>
          <p>Gestión y Sincronización Automática de Videos</p>
        </div>

        <div className={styles.headerActions}>
          <button
            onClick={() => {
              setConfigInput({ GEMINI_API_KEY: "", YOUTUBE_CLIENT_ID: "", YOUTUBE_CLIENT_SECRET: "" });
              setShowSettings(true);
            }}
            className={styles.btnSettingsToggle}
            title="Credenciales"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

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

      {/* Dashboard Grid */}
      <div className={styles.dashboardGrid}>
        {/* Columna Izquierda: Sincronización, PDF Editor e Inline Form */}
        <div className={styles.mainCol}>
          
          {/* Tarjeta de Selección y Carga */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>Editor de Videos</div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Selector de Video por ID directo */}
              <div className={styles.inputGroup}>
                <label>ID Video YouTube</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="text"
                    value={youtubeId}
                    onChange={(e) => setYoutubeId(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    onClick={() => fetchYoutubeVideoById(youtubeId)}
                    disabled={loadingYoutubeVideo || !youtubeId}
                    className={styles.btnSubmit}
                    style={{ width: "auto", whiteSpace: "nowrap" }}
                  >
                    {loadingYoutubeVideo ? "Buscando..." : "Buscar Video"}
                  </button>
                </div>
              </div>

              {/* Índice de Vídeo en el PDF (Autocalculado y Manual) */}
              <div className={styles.inputGroup} style={{ marginTop: "0.5rem" }}>
                <label htmlFor="videoIndexSelect">Selecciona nº de video</label>
                <select
                  id="videoIndexSelect"
                  value={videoIndex}
                  disabled={!pdfFile && !savedPdfName}
                  onChange={(e) => setVideoIndex(parseInt(e.target.value))}
                  style={{ 
                    background: "var(--bg-surface-solid)", 
                    color: "var(--text-primary)", 
                    padding: "0.5rem", 
                    borderRadius: "6px",
                    opacity: (!pdfFile && !savedPdfName) ? 0.5 : 1,
                    cursor: (!pdfFile && !savedPdfName) ? "not-allowed" : "default"
                  }}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                    <option key={num} value={num} style={{ background: "var(--bg-surface-solid)", color: "var(--text-primary)" }}>
                      Vídeo {num} {num === 1 ? "(Letizia / Mantilla)" : num === 2 ? "(Aviso Mos / Gasóleo)" : num === 3 ? "(Mantemento Bateas)" : ""}
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <input
                    type="checkbox"
                    id="autoIncrementToggle"
                    checked={autoIncrement}
                    onChange={(e) => setAutoIncrement(e.target.checked)}
                    style={{ cursor: "pointer" }}
                  />
                  <label htmlFor="autoIncrementToggle" style={{ cursor: "pointer", fontSize: "0.8rem", color: "var(--text-muted)", userSelect: "none" }}>
                    Autoincrementar número de vídeo tras copiar datos
                  </label>
                </div>
              </div>

              {/* Dropzone del PDF */}
              <div className={styles.inputGroup} style={{ marginTop: "0.5rem" }}>
                <label>Documento PDF de Referencia de la Empresa</label>
                <div
                  className={styles.uploadArea}
                  style={{ padding: "1.5rem", border: "2px dashed var(--border-color)", borderRadius: "8px", textAlign: "center", cursor: "pointer", background: "rgba(255,255,255,0.01)" }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file && file.type === "application/pdf") {
                      setPdfFile(file);
                    } else {
                      alert("Por favor, sube un archivo PDF válido.");
                    }
                  }}
                  onClick={() => pdfInputRef.current?.click()}
                >
                  <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📄</div>
                  <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: "500" }}>
                    {pdfFile 
                      ? `PDF Seleccionado: ${pdfFile.name}` 
                      : savedPdfName 
                        ? `PDF Activo Guardado: ${savedPdfName}` 
                        : "Arrastra tu documento PDF de referencia aquí o haz clic para explorar"
                    }
                  </p>
                </div>
                <input
                  type="file"
                  ref={pdfInputRef}
                  accept="application/pdf"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) setPdfFile(file);
                  }}
                  style={{ display: "none" }}
                />
              </div>

              {/* Botón de Acción de Análisis */}
              <button
                type="button"
                onClick={handleAnalyzePdf}
                disabled={isAnalyzingPdf || (!pdfFile && !savedPdfName) || !youtubeId}
                className={styles.btnSubmit}
                style={{ background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", opacity: (isAnalyzingPdf || (!pdfFile && !savedPdfName) || !youtubeId) ? 0.6 : 1 }}
              >
                {isAnalyzingPdf ? "Procesando y copiando datos..." : "⚡ Copiar Datos del PDF al Editor"}
              </button>
            </div>
          </div>

          {/* Formulario de Edición (Si hay un video seleccionado) */}
          {selectedYoutubeVideo && (
            <form onSubmit={handleSaveYoutubeVideoChanges} className={styles.inlineEditPanel} style={{ display: "block", marginTop: "1.5rem" }}>
              <div className={styles.inlineEditHeader}>
                <div>
                  <h3>✏️ Editor de YouTube</h3>
                  <span style={{ fontSize: "0.8rem", color: "#a855f7", fontWeight: "600" }}>
                    Vídeo seleccionado: {selectedYoutubeVideo.title.substring(0, 50)}...
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedYoutubeVideo(null);
                    setYoutubeId("");
                    handleResetThumbnailStates();
                  }}
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
                  <strong>Estado actual:</strong> Pendiente de sincronización.
                  <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Los datos correspondientes al Vídeo {videoIndex} del PDF se han copiado literalmente. Sincroniza para finalizar.
                  </span>
                </div>
              </div>

              <div className={styles.inlineEditContent}>
                {/* Columna Izquierda: Sugerencias e Información */}
                <div className={styles.inlineEditColLeft}>
                  <div className={styles.selectedVideoPreview}>
                    <img src={selectedYoutubeVideo.thumbnail} alt="Preview" className={styles.selectedVideoThumbnail} />
                    <div className={styles.selectedVideoInfo}>
                      <h5 style={{ fontSize: "0.85rem", margin: 0 }}>{selectedYoutubeVideo.title}</h5>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>ID: {selectedYoutubeVideo.id}</span>
                    </div>
                  </div>
                </div>

                {/* Columna Derecha: Campos e Miniatura */}
                <div className={styles.inlineEditColRight}>
                  <div className={styles.inputGroup}>
                    <label style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Título en YouTube (Copiar/Pegar literal)</span>
                      <span style={{ fontSize: "0.75rem", color: updateForm.title.length >= 90 ? "#ef4444" : "var(--text-muted)" }}>
                        {updateForm.title.length}/100
                      </span>
                    </label>
                    <textarea
                      rows="2"
                      required
                      maxLength={100}
                      value={updateForm.title}
                      onChange={(e) => setUpdateForm({ ...updateForm, title: e.target.value })}
                      style={{ resize: "none" }}
                    />
                  </div>

                  <div className={styles.inputGroup}>
                    <label>Descripción (Copiar/Pegar literal)</label>
                    <textarea
                      rows="8"
                      required
                      value={updateForm.description}
                      onChange={(e) => setUpdateForm({ ...updateForm, description: e.target.value })}
                    />
                  </div>



                  {/* Portada / Miniatura estilo TVG */}
                  <div style={{
                    border: "1px solid var(--border-color)",
                    borderRadius: "12px",
                    padding: "1rem",
                    marginTop: "1rem",
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
                        <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", borderRadius: "6px", overflow: "hidden", border: "1px solid var(--border-color)", background: "#000" }}>
                          {newThumbnailBase64 ? (
                            <img src={newThumbnailBase64} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                              {isGeneratingThumbnail ? "Componiendo lienzo..." : "Preparando canvas..."}
                            </div>
                          )}
                        </div>

                        <div className={styles.inputGroup} style={{ margin: 0 }}>
                          <label style={{ fontSize: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>Texto SEO Gallego (4 palabras)</span>
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
                            onChange={(e) => setThumbnailText(e.target.value)}
                            placeholder="Ej: GRAN CONCURSO HORA GALEGA"
                          />
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
                            <span>Fondo Personalizado</span>
                            {customBgBase64 && (
                              <button type="button" onClick={() => setCustomBgBase64(null)} style={{ background: "none", border: "none", color: "#ef4444", fontSize: "0.7rem", cursor: "pointer", padding: 0 }}>Restaurar</button>
                            )}
                          </label>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onload = (ev) => setCustomBgBase64(ev.target.result);
                                reader.readAsDataURL(file);
                              }
                            }}
                            style={{ background: "transparent", border: "none", fontSize: "0.8rem" }}
                          />
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
                                   {selectedProgramLogo === "default"
                                     ? "Hora Galega (Por defecto)"
                                     : selectedProgramLogo === "none"
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
                                       key="default"
                                       style={{ padding: "0.4rem", cursor: "pointer", borderRadius: "4px" }}
                                       onClick={() => {
                                         setSelectedProgramLogo("default");
                                         setLogoDropdownOpen(false);
                                       }}
                                     >
                                       Hora Galega (Por defecto)
                                     </li>
                                     <li
                                       key="none"
                                       style={{ padding: "0.4rem", cursor: "pointer", borderRadius: "4px" }}
                                       onClick={() => {
                                         setSelectedProgramLogo("none");
                                         setLogoDropdownOpen(false);
                                       }}
                                     >
                                       Ninguno (Sin logotipo)
                                     </li>
                                     {programLogosCatalog.map((logo) => (
                                       <li
                                         key={logo}
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
                                             setSelectedProgramLogo(logo);
                                             setLogoDropdownOpen(false);
                                           }}
                                         >
                                           {logo.replace(/\.[^/.]+$/, "").replace(/_/g, " ")}
                                         </span>
                                         <button
                                           type="button"
                                           aria-label={`Eliminar ${logo}`}
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
                                             if (!confirm(`¿Eliminar el logotipo "${logo}"?`)) return;
                                             try {
                                               const res = await fetch("/api/program-logos", {
                                                 method: "DELETE",
                                                 headers: { "Content-Type": "application/json" },
                                                 body: JSON.stringify({ filename: logo }),
                                               });
                                               const data = await res.json();
                                               if (data.success) {
                                                 await fetchProgramLogosCatalog();
                                                 if (selectedProgramLogo === logo) setSelectedProgramLogo("default");
                                               } else {
                                                 alert("Error al eliminar logotipo: " + data.error);
                                               }
                                             } catch (err) {
                                               console.error("Error al eliminar logotipo:", err);
                                             }
                                           }}
                                         >
                                           ✖
                                         </button>
                                       </li>
                                     ))}
                                   </ul>
                                 )}
                               </div>
                            <label
                              className={styles.btnSubmit}
                              style={{
                                padding: "0.4rem 0.6rem",
                                fontSize: "0.75rem",
                                cursor: "pointer",
                                display: "inline-block",
                                textAlign: "center",
                                whiteSpace: "nowrap",
                                margin: 0,
                                width: "auto",
                                color: "#fff",
                              }}
                            >
                              Subir Logo
                              <input
                                type="file"
                                accept="image/png"
                                onChange={async (e) => {
                                  const file = e.target.files[0];
                                  if (file) {
                                    const formData = new FormData();
                                    formData.append("file", file);
                                    try {
                                      const res = await fetch("/api/program-logos", {
                                        method: "POST",
                                        body: formData,
                                      });
                                      const data = await res.json();
                                      if (data.success) {
                                        await fetchProgramLogosCatalog();
                                        setSelectedProgramLogo(data.filename);
                                      } else {
                                        alert("Error subiendo logotipo: " + data.error);
                                      }
                                    } catch (err) {
                                      console.error("Error subiendo logotipo:", err);
                                    }
                                  }
                                }}
                                style={{ display: "none" }}
                              />
                            </label>
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

                    <canvas ref={canvasRef} style={{ display: "none" }} />
                  </div>

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
                      <input
                        type="datetime-local"
                        required={updateForm.isScheduled}
                        value={updateForm.scheduledAt}
                        onChange={(e) => setUpdateForm({ ...updateForm, scheduledAt: e.target.value })}
                      />
                    </div>
                  )}

                  <div className={styles.inlineEditActions} style={{ marginTop: "1rem" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedYoutubeVideo(null);
                        setYoutubeId("");
                        handleResetThumbnailStates();
                      }}
                      className={styles.btnCancel}
                      style={{ flex: 1 }}
                    >Cancelar</button>
                    <button
                      type="submit"
                      disabled={updatingYoutubeVideo}
                      className={styles.btnSubmit}
                      style={{ flex: 1.5 }}
                    >
                      {updatingYoutubeVideo ? "Sincronizando..." : updateForm.isScheduled ? "Programar Cambios" : "Guardar en YouTube"}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* Actualizaciones locales programadas activas */}
          {scheduledUpdates.length > 0 && (
            <div className={styles.card} style={{ marginTop: "1.5rem" }}>
              <div className={styles.cardTitle}>Cola de Actualizaciones Programadas Locales</div>
              <div className={styles.tasksList}>
                {scheduledUpdates.map(update => (
                  <div key={update.id} className={styles.taskCardPending} style={{ borderLeftColor: "#f59e0b" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <h4 style={{ fontSize: "0.85rem", margin: 0 }}>{update.title || "Actualización pendiente"}</h4>
                      <span className={styles.statusBadge} style={{ background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b", padding: "2px 8px", borderRadius: "12px", fontSize: "0.7rem" }}>
                        {update.status === "SCHEDULED" ? "Programada" : "Aplicando..."}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                      <strong>ID YouTube:</strong> <code>{update.youtubeId}</code> | <strong>Ejecución:</strong> {formatDate(update.scheduledAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Columna Derecha: Tareas (Pendientes y Realizadas) */}
        <div className={styles.sidebarCol}>
          
          {/* Pendientes de Sincronización */}
          <div className={styles.card}>
            <div className={styles.cardTitle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Videos Pendientes</span>
              <button onClick={fetchTasks} className={styles.refreshBtn} title="Actualizar">🔄</button>
            </div>

             {loadingTasks ? (
              <div className={styles.emptyState}>Cargando...</div>
            ) : tasks.filter(t => t.status === "PENDIENTE_SINCRONIZACION" || t.status === "PENDING" || t.status === "SCHEDULED").length === 0 ? (
              <div className={styles.emptyState}>No hay videos pendientes de sincronización. ¡Buen trabajo!</div>
            ) : (
              <div className={styles.tasksList}>
                {tasks.filter(t => t.status === "PENDIENTE_SINCRONIZACION" || t.status === "PENDING" || t.status === "SCHEDULED").map(task => {
                  const isScheduled = task.status === "SCHEDULED";
                  const scheduledUpdate = scheduledUpdates.find(u => u.youtubeId === task.youtubeId);
                  const scheduledDateStr = scheduledUpdate ? formatDate(scheduledUpdate.scheduledAt) : null;

                  return (
                    <div key={task.id} className={styles.taskCardPending} style={isScheduled ? { borderLeftColor: "#f59e0b" } : undefined}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", flex: 1 }}>
                          <h4 className={styles.taskCardTitle}>{task.title}</h4>
                          {isScheduled ? (
                            <span style={{
                              background: "rgba(245, 158, 11, 0.15)",
                              color: "#f59e0b",
                              padding: "2px 8px",
                              borderRadius: "12px",
                              fontSize: "0.7rem",
                              width: "fit-content",
                              whiteSpace: "nowrap"
                            }}>Programada</span>
                          ) : (
                            <span style={{
                              background: "rgba(168, 85, 247, 0.15)",
                              color: "#a855f7",
                              padding: "2px 8px",
                              borderRadius: "12px",
                              fontSize: "0.7rem",
                              width: "fit-content",
                              whiteSpace: "nowrap"
                            }}>Pendiente Sync</span>
                          )}
                        </div>
                        <button
                          onClick={async () => {
                            const confirmMsg = isScheduled 
                              ? "¿Deseas eliminar esta tarea y cancelar su sincronización programada?"
                              : "¿Deseas eliminar esta tarea pendiente?";
                            if (confirm(confirmMsg)) {
                              try {
                                const res = await fetch(`/api/tasks?id=${task.id}`, { method: 'DELETE' });
                                if (res.ok) {
                                  fetchTasks();
                                  fetchScheduledUpdates();
                                }
                              } catch (err) {
                                console.error(err);
                              }
                            }
                          }}
                          className={styles.taskActionBtnDelete}
                          style={{ marginTop: "2px" }}
                        >✕</button>
                      </div>
                      <p className={styles.taskCardDesc} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{task.description}</p>
                      
                      {isScheduled && scheduledDateStr && (
                        <div style={{ fontSize: "0.7rem", color: "#f59e0b", marginTop: "0.25rem", fontWeight: "500" }}>
                          ⏰ Programado: {scheduledDateStr}
                        </div>
                      )}

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>ID: {task.youtubeId}</span>
                        <button
                          onClick={() => handleWorkOnTask(task)}
                          className={styles.btnSubmit}
                          style={{
                            width: "auto",
                            fontSize: "0.75rem",
                            padding: "0.3rem 0.75rem",
                            background: isScheduled ? "#f59e0b" : "#a855f7",
                            border: "none"
                          }}
                        >
                          Cargar en Editor
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Completadas */}
          <div className={styles.card} style={{ marginTop: "1.5rem" }}>
            <div className={styles.cardTitle}>Historial: Sincronizaciones Realizadas</div>
            
            {loadingTasks ? (
              <div className={styles.emptyState}>Cargando tareas...</div>
            ) : tasks.filter(t => t.status === "COMPLETED").length === 0 ? (
              <div className={styles.emptyState}>No hay videos sincronizados recientemente.</div>
            ) : (
              <div className={styles.tasksList}>
                {tasks.filter(t => t.status === "COMPLETED").map(task => (
                  <div key={task.id} className={styles.taskCardCompleted}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                      <h4 className={styles.taskCardTitle} style={{ textDecoration: "line-through", color: "var(--text-muted)" }}>
                        {task.title}
                      </h4>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/tasks?id=${task.id}`, { method: 'DELETE' });
                            if (res.ok) {
                              fetchTasks();
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
                        <div><strong>ID YouTube:</strong> <code>{task.youtubeId}</code></div>
                        {task.completedAt && (
                          <div><strong>Sincronizado el:</strong> {formatDate(task.completedAt)}</div>
                        )}
                      </div>
                      <a
                        href={`https://studio.youtube.com/video/${task.youtubeId}/edit`}
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

        </div>
      </div>

      {/* Modal de Configuración */}
      {showSettings && (
        <div className={styles.settingsOverlay}>
          <form onSubmit={handleSaveConfig} className={styles.settingsModal}>
            <div className={styles.settingsHeader}>
              <h2>Configurar Credenciales de Empresa</h2>
              <button type="button" onClick={() => setShowSettings(false)} className={styles.closeBtn}>✕</button>
            </div>

            <div className={styles.inputGroup}>
              <label>Gemini API Key</label>
              <input
                type="password"
                value={configInput.GEMINI_API_KEY}
                onChange={(e) => setConfigInput({ ...configInput, GEMINI_API_KEY: e.target.value })}
                placeholder={config.GEMINI_API_KEY ? "(Configurada)" : "Pega tu API Key de Gemini"}
              />
            </div>

            <div className={styles.inputGroup}>
              <label>Google OAuth Client ID</label>
              <input
                type="text"
                value={configInput.YOUTUBE_CLIENT_ID}
                onChange={(e) => setConfigInput({ ...configInput, YOUTUBE_CLIENT_ID: e.target.value })}
                placeholder={config.YOUTUBE_CLIENT_ID ? "(Configurado)" : "Client ID"}
              />
            </div>

            <div className={styles.inputGroup}>
              <label>Google OAuth Client Secret</label>
              <input
                type="password"
                value={configInput.YOUTUBE_CLIENT_SECRET}
                onChange={(e) => setConfigInput({ ...configInput, YOUTUBE_CLIENT_SECRET: e.target.value })}
                placeholder={config.YOUTUBE_CLIENT_SECRET ? "(Configurado)" : "Client Secret"}
              />
            </div>

            <div className={styles.settingsActions}>
              <button type="button" onClick={() => setShowSettings(false)} className={styles.btnCancel}>Cancelar</button>
              <button type="submit" disabled={savingConfig} className={styles.btnSubmit} style={{ width: "auto" }}>
                {savingConfig ? "Guardando..." : "Guardar Cambios"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
