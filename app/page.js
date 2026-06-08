"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import styles from "./page.module.css";

// Ayudante para generar un UUID aleatorio, con soporte para navegadores antiguos/contextos no seguros
function generateUUID() {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
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

  // Estado de subida/análisis
  const [uploadState, setUploadState] = useState({
    file: null,
    status: "idle", // inactivo, subiendo, analizando, listo, éxito, error
    progress: 0,
    speed: "",
    videoId: "",
    errorMessage: "",
  });

  // Estado del formulario de metadatos
  const [metadata, setMetadata] = useState({
    selectedTitle: "",
    titlesOptions: [],
    description: "",
    tags: "",
    isScheduled: false,
    scheduledAt: "",
  });

  // Estado de la cola/historial de videos
  const [videosList, setVideosList] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);
  const [deletingVideoId, setDeletingVideoId] = useState(null);
  const deleteTimeoutRef = useRef(null);

  // Estado del idioma
  const [language, setLanguage] = useState("Spanish");

  // Estado del modal de edición de video
  const [editingVideo, setEditingVideo] = useState(null);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    tags: "",
    status: "",
    isScheduled: false,
    scheduledAt: "",
  });
  const [isUpdatingVideo, setIsUpdatingVideo] = useState(false);
  const [extractedThumbnail, setExtractedThumbnail] = useState(null);

  // Pestañas (Tabs)
  const [activeTab, setActiveTab] = useState("upload");

  // Estado de optimización de videos de YouTube
  const [youtubeVideos, setYoutubeVideos] = useState([]);
  const [loadingYoutubeVideos, setLoadingYoutubeVideos] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedYoutubeVideo, setSelectedYoutubeVideo] = useState(null);
  const [optimizingVideo, setOptimizingVideo] = useState(false);
  const [optimizationSuggestions, setOptimizationSuggestions] = useState(null);
  const [updateForm, setUpdateForm] = useState({ title: "", description: "", tags: "", isScheduled: false, scheduledAt: "" });
  const [newThumbnailBase64, setNewThumbnailBase64] = useState(null);
  const [updatingYoutubeVideo, setUpdatingYoutubeVideo] = useState(false);

  // Comprobar estado de conexión, configuración y obtener la cola de videos
  useEffect(() => {
    fetchConfig();
    fetchChannel();
    fetchVideos();
  }, []);

  useEffect(() => {
    if (activeTab === "optimize" && channel.connected) {
      fetchYoutubeVideos();
    }
  }, [activeTab, channel.connected]);

  // Consultar el estado de la base de datos si hay tareas activas (subiendo o analizando)
  useEffect(() => {
    const hasActiveTasks = videosList.some(
      (v) => v.status === "UPLOADING" || v.status === "ANALYZING"
    );

    if (hasActiveTasks || uploadState.status === "analyzing" || uploadState.status === "uploading") {
      const interval = setInterval(() => {
        fetchVideos();
        // Si estamos esperando un análisis específico en la sesión actual, comprobar su estado
        if (uploadState.videoId && (uploadState.status === "analyzing" || uploadState.status === "uploading")) {
          checkCurrentVideoStatus(uploadState.videoId);
        }
      }, 2000); // Consulta cada 2 segundos por tareas activas para mantener fluida la barra de progreso
      return () => clearInterval(interval);
    }
  }, [videosList, uploadState.status, uploadState.videoId]);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.error("Error fetching config:", err);
    }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configInput),
      });

      if (!res.ok) {
        throw new Error("Fallo al guardar la configuración.");
      }

      alert("Configuración guardada correctamente.");
      setShowSettings(false);
      setConfigInput({ GEMINI_API_KEY: "", YOUTUBE_CLIENT_ID: "", YOUTUBE_CLIENT_SECRET: "" });
      await fetchConfig();
      await fetchChannel(); // Volver a obtener la conexión del canal en caso de que cambien las credenciales
    } catch (err) {
      alert("Error al guardar: " + err.message);
    } finally {
      setSavingConfig(false);
    }
  };

  const fetchChannel = async () => {
    try {
      const res = await fetch("/api/channel");
      const data = await res.json();
      setChannel(data);
    } catch (err) {
      console.error("Error fetching channel:", err);
    } finally {
      setLoadingChannel(false);
    }
  };

  const fetchVideos = async () => {
    try {
      const res = await fetch("/api/videos");
      const data = await res.json();
      setVideosList(data);
    } catch (err) {
      console.error("Error fetching videos queue:", err);
    }
  };

  const handleDeleteVideo = async (id) => {
    if (deletingVideoId !== id) {
      setDeletingVideoId(id);
      if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
      deleteTimeoutRef.current = setTimeout(() => {
        setDeletingVideoId(null);
      }, 4000); // 4 segundos para hacer clic de nuevo para confirmar
      return;
    }

    // Segundo clic: realizar la eliminación desde la aplicación local
    setDeletingVideoId(null);
    if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);

    try {
      const res = await fetch(`/api/videos?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al eliminar el video");
      }
      fetchVideos();
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  const handleEditVideo = (video) => {
    setEditingVideo(video);
    setEditForm({
      title: video.title || "",
      description: video.description || "",
      tags: video.tags || "",
      status: video.status || "DRAFT",
      isScheduled: !!video.scheduledAt,
      scheduledAt: video.scheduledAt ? new Date(video.scheduledAt).toISOString().substring(0, 16) : "",
    });
  };

  const handleUpdateVideo = async (e) => {
    e.preventDefault();
    if (!editingVideo) return;
    setIsUpdatingVideo(true);
    try {
      const res = await fetch(`/api/videos?id=${editingVideo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editForm.title,
          description: editForm.description,
          tags: editForm.tags,
          status: editForm.status,
          scheduledAt: editForm.isScheduled ? editForm.scheduledAt : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al actualizar los datos del video");
      }

      alert("Video actualizado con éxito.");
      setEditingVideo(null);
      fetchVideos();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setIsUpdatingVideo(false);
    }
  };

  const fetchYoutubeVideos = async (q = "") => {
    setLoadingYoutubeVideos(true);
    try {
      const url = q ? `/api/youtube/videos?q=${encodeURIComponent(q)}` : "/api/youtube/videos";
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fallo al obtener videos de YouTube");
      }
      const data = await res.json();
      setYoutubeVideos(data);
    } catch (err) {
      console.error("Error fetching YouTube videos:", err);
      if (channel.connected) {
        alert("Error al cargar videos de YouTube: " + err.message);
      }
    } finally {
      setLoadingYoutubeVideos(false);
    }
  };

  const handleOptimizeVideo = async (videoId) => {
    setOptimizingVideo(true);
    setOptimizationSuggestions(null);
    try {
      const res = await fetch("/api/youtube/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeVideoId: videoId, language: language }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fallo al optimizar el video");
      }

      const data = await res.json();
      setOptimizationSuggestions(data.suggestions);
      setUpdateForm({
        title: data.suggestions.titles[0] || data.current.title || "",
        description: data.suggestions.description || data.current.description || "",
        tags: data.suggestions.tags.join(', ') || data.current.tags || "",
        isScheduled: false,
        scheduledAt: ""
      });
    } catch (err) {
      alert("Error al optimizar con IA: " + err.message);
    } finally {
      setOptimizingVideo(false);
    }
  };

  const handleNewThumbnailSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        // Establecer el estado con el archivo original de inmediato para asegurar que la miniatura
        // se renderice en la interfaz al instante sin depender de la carga asíncrona de la imagen.
        setNewThumbnailBase64(event.target.result);

        try {
          const img = new Image();
          img.onerror = () => {
            console.warn("[Thumbnail] Fallo al cargar el objeto Image, se usará el archivo original.");
          };
          img.onload = () => {
            try {
              const canvas = document.createElement("canvas");
              // Las miniaturas de YouTube deben ser de 1280x720 (16:9)
              const targetWidth = 1280;
              const targetHeight = 720;
              canvas.width = targetWidth;
              canvas.height = targetHeight;
              
              const ctx = canvas.getContext("2d");
              if (!ctx) {
                console.warn("[Thumbnail] No se pudo obtener el contexto 2d del canvas.");
                return;
              }

              // Dibujar la imagen recortándola y escalándola para llenar el lienzo de 1280x720 (object-fit: cover)
              const imgRatio = img.width / img.height;
              const targetRatio = targetWidth / targetHeight;
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
              
              ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight, 0, 0, targetWidth, targetHeight);
              
              // Exportar como JPEG con calidad 0.8 para asegurar un tamaño de archivo inferior a 250kb,
              // evitando el límite de 1MB de Tunnelmole que causa el error 413 Payload Too Large.
              const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
              setNewThumbnailBase64(dataUrl);
              console.log("[Thumbnail] Imagen comprimida correctamente en segundo plano.");
            } catch (canvasErr) {
              console.error("[Thumbnail] Error procesando compresión con canvas:", canvasErr);
            }
          };
          img.src = event.target.result;
        } catch (err) {
          console.error("[Thumbnail] Error en el flujo de compresión de imagen:", err);
        }
      };
      reader.readAsDataURL(file);
    }
  };

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
        throw new Error(data.error || "Fallo al guardar cambios");
      }

      const responseData = await res.json();
      if (responseData.scheduled) {
        alert("¡Actualización de video programada con éxito!");
        fetchVideos(); // Actualizar la lista de la cola
      } else {
        alert("¡Video actualizado en YouTube con éxito!");
      }
      setSelectedYoutubeVideo(null);
      setOptimizationSuggestions(null);
      setNewThumbnailBase64(null);
      fetchYoutubeVideos(searchQuery);
    } catch (err) {
      alert("Error al guardar cambios en YouTube: " + err.message);
    } finally {
      setUpdatingYoutubeVideo(false);
    }
  };

  const checkCurrentVideoStatus = async (id) => {
    try {
      const res = await fetch(`/api/videos?id=${id}`);
      if (!res.ok) return;
      const video = await res.json();

      if (video.status === "READY" && uploadState.status === "analyzing") {
        setUploadState((prev) => ({ ...prev, status: "ready" }));
        setMetadata({
          selectedTitle: video.title || "",
          titlesOptions: [video.title].filter(Boolean), // El backend almacena el título principal
          description: video.description || "",
          tags: video.tags || "",
          isScheduled: false,
          scheduledAt: "",
        });
      } else if (video.status === "FAILED") {
        setUploadState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: video.errorMessage || "El análisis del video falló.",
        }));
      }
    } catch (err) {
      console.error("Error checking video status:", err);
    }
  };

  const disconnectChannel = async () => {
    if (window.confirm("¿Estás seguro de que deseas desconectar el canal de YouTube de la empresa?")) {
      try {
        const res = await fetch("/api/channel", { method: "DELETE" });
        if (res.ok) {
          setChannel({ connected: false, channel: null });
        }
      } catch (err) {
        alert("Error al desconectar el canal");
      }
    }
  };

  // Controladores de arrastrar y soltar
  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("video/")) {
      startChunkedUpload(file);
    } else {
      alert("Por favor, selecciona un archivo de video válido.");
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      startChunkedUpload(file);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const extractThumbnail = (file) => {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.src = URL.createObjectURL(file);

      video.onloadedmetadata = () => {
        video.currentTime = Math.min(3, video.duration / 2);
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          const scale = Math.min(1, 640 / video.videoWidth);
          canvas.width = video.videoWidth * scale;
          canvas.height = video.videoHeight * scale;

          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          resolve(dataUrl);
        } catch (err) {
          console.error("Failed to draw video frame:", err);
          resolve(null);
        } finally {
          URL.revokeObjectURL(video.src);
        }
      };

      video.onerror = () => {
        console.error("Error loading video for thumbnail extraction");
        resolve(null);
      };
    });
  };

  // Implementación de subida fragmentada
  const startChunkedUpload = async (file) => {
    const uploadId = generateUUID();
    // Ajustar dinámicamente el tamaño del fragmento según si el usuario accede localmente o a través de un túnel
    const isLocal = typeof window !== "undefined" && 
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname.startsWith("192.168."));
    
    // Configuración optimizada de tamaño y concurrencia:
    // - Local: 5MB por fragmento y concurrencia de 6 (máxima velocidad)
    // - Túnel (Tunnelmole/móvil): 400KB por fragmento y concurrencia de 2 (máxima estabilidad en redes externas y túneles)
    const chunkSize = isLocal ? 5 * 1024 * 1024 : 400 * 1024;
    const limit = isLocal ? 6 : 2;
    const totalChunks = Math.ceil(file.size / chunkSize);

    setUploadState({
      file,
      status: "uploading",
      progress: 0,
      speed: "Calculando...",
      videoId: "",
      errorMessage: "",
    });

    let extractedThumbBase64 = null;
    try {
      extractedThumbBase64 = await extractThumbnail(file);
      setExtractedThumbnail(extractedThumbBase64);
    } catch (thumbErr) {
      console.error("Error extracting thumbnail:", thumbErr);
    }

    const startTime = Date.now();
    let uploadedBytes = 0;
    let completedTriggered = false;

    // Crear un arreglo con los índices de todos los fragmentos
    const chunkIndices = Array.from({ length: totalChunks }, (_, i) => i);

    // Función interna para subir un fragmento específico con reintentos
    const uploadChunkTask = async (chunkIndex) => {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      const formData = new FormData();
      formData.append("chunk", chunk);
      formData.append("fileName", file.name);
      formData.append("uploadId", uploadId);
      formData.append("chunkIndex", chunkIndex.toString());
      formData.append("totalChunks", totalChunks.toString());

      let attempts = 0;
      const maxAttempts = 3;
      let res;
      let data;

      while (attempts < maxAttempts) {
        try {
          res = await fetch("/api/upload/chunk", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            throw new Error(`El servidor respondió con código ${res.status}`);
          }

          data = await res.json();
          break; // Salir del bucle si la subida fue exitosa
        } catch (fetchErr) {
          attempts++;
          if (attempts >= maxAttempts) {
            throw new Error(`El fragmento ${chunkIndex + 1} falló tras ${maxAttempts} intentos: ${fetchErr.message}`);
          }
          console.warn(`Intento ${attempts} fallido para el fragmento ${chunkIndex + 1}. Reintentando en 1s...`);
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Esperar 1 segundo antes de reintentar
        }
      }

      uploadedBytes += end - start;
      const progressPercent = Math.round((uploadedBytes / file.size) * 100);

      // Cálculo de velocidad de subida
      const timeElapsed = (Date.now() - startTime) / 1000; // segundos
      const speedMB = uploadedBytes / (1024 * 1024) / timeElapsed; // MB/s

      setUploadState((prev) => ({
        ...prev,
        progress: progressPercent,
        speed: `${speedMB.toFixed(1)} MB/s`,
      }));

      // Si el servidor confirma que todos los fragmentos han sido recibidos y ensamblados
      if (data && data.completed) {
        if (!completedTriggered) {
          completedTriggered = true;

          // Subir la miniatura extraída si está disponible
          if (extractedThumbBase64) {
            try {
              await fetch("/api/upload/thumbnail", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ videoId: data.videoId, thumbnail: extractedThumbBase64 }),
              });
              console.log("Miniatura extraída subida con éxito al backend.");
            } catch (upThumbErr) {
              console.error("Fallo al subir la miniatura extraída al backend:", upThumbErr);
            }
          }

          setUploadState((prev) => ({
            ...prev,
            status: "analyzing",
            videoId: data.videoId,
          }));

          // Iniciar el análisis automatizado con Gemini
          triggerAnalysis(data.videoId, language);
        }
      }
    };

    // Ejecutor de subida con límite de concurrencia (Promise Pool)
    const runPool = async () => {
      const pool = [];
      for (const index of chunkIndices) {
        // Ejecutar la tarea de subida y registrarla en el pool activo
        const promise = uploadChunkTask(index).then(() => {
          // Eliminar del pool una vez que la promesa se resuelva
          pool.splice(pool.indexOf(promise), 1);
        });
        pool.push(promise);

        // Si alcanzamos el límite de concurrencia, esperamos a que al menos una termine
        if (pool.length >= limit) {
          await Promise.race(pool);
        }
      }
      // Esperar a que todos los fragmentos restantes en el pool finalicen
      await Promise.all(pool);
    };

    try {
      await runPool();

      // Control adicional por si todos terminaron pero no se recibió completed en el cliente por algún fallo de red
      if (!completedTriggered) {
        throw new Error("La subida finalizó pero el servidor no confirmó el ensamblado del video.");
      }
    } catch (err) {
      if (!completedTriggered) {
        setUploadState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: err.message || "Error al subir el video.",
        }));
        fetchVideos();
      }
    }
  };

  const triggerAnalysis = async (videoId, lang = language) => {
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, language: lang }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "El análisis falló.");
      }

      const data = await res.json();
      setUploadState((prev) => ({ ...prev, status: "ready" }));
      setMetadata({
        selectedTitle: data.titles[0] || "",
        titlesOptions: data.titles || [],
        description: data.description || "",
        tags: data.tags || "",
        isScheduled: false,
        scheduledAt: "",
      });
      fetchVideos();
    } catch (err) {
      setUploadState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: err.message || "Error al analizar el video con IA.",
      }));
      fetchVideos();
    }
  };

  const handleSubmitMetadata = async (e) => {
    e.preventDefault();
    if (!uploadState.videoId) return;

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: uploadState.videoId,
          title: metadata.selectedTitle,
          description: metadata.description,
          tags: metadata.tags,
          scheduledAt: metadata.isScheduled ? metadata.scheduledAt : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fallo al iniciar programación");
      }

      setUploadState({
        file: null,
        status: "success",
        progress: 0,
        speed: "",
        videoId: "",
        errorMessage: "",
      });

      fetchVideos();
    } catch (err) {
      alert("Error al programar el video: " + err.message);
    } finally {
      setIsSubmitting(false);
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

  const getStatusText = (status) => {
    switch (status) {
      case "DRAFT": return "Borrador";
      case "ANALYZING": return "Analizando con IA...";
      case "READY": return "Listo para Programar";
      case "UPLOADING": return "Subiendo a YouTube...";
      case "SCHEDULED": return "Programado";
      case "COMPLETED": return "Publicado";
      case "FAILED": return "Fallido";
      default: return status;
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case "DRAFT": return styles.badgeDraft;
      case "ANALYZING": return styles.badgeAnalyzing;
      case "READY": return styles.badgeReady;
      case "UPLOADING": return styles.badgeUploading;
      case "SCHEDULED": return styles.badgeScheduled;
      case "COMPLETED": return styles.badgeCompleted;
      case "FAILED": return styles.badgeFailed;
      default: return "";
    }
  };

  return (
    <div className={styles.container}>
      {/* Header Section */}
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <h1>AutomYouTube</h1>
          <p>Sube, optimiza y programa videos de larga y corta duración optimizados con Gemini IA</p>
        </div>

        <div className={styles.headerActions}>
          {/* Botón de Configuración */}
          <button
            onClick={() => {
              setConfigInput({
                GEMINI_API_KEY: "",
                YOUTUBE_CLIENT_ID: "",
                YOUTUBE_CLIENT_SECRET: "",
              });
              setShowSettings(true);
            }}
            className={styles.btnSettingsToggle}
            title="Configuración de Credenciales"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          {loadingChannel ? (
            <div className={styles.channelCard}>Cargando canal...</div>
          ) : channel.connected ? (
            <div className={styles.channelCard}>
              {channel.channel.thumbnail && (
                <img
                  src={channel.channel.thumbnail}
                  alt={channel.channel.title}
                  className={styles.channelAvatar}
                />
              )}
              <div className={styles.channelInfo}>
                <span className={styles.channelName}>{channel.channel.title}</span>
                <span className={styles.channelStatus}>Conectado</span>
              </div>
              <button onClick={disconnectChannel} className={styles.disconnectBtn}>
                Desconectar
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                if (!config.isConfigured) {
                  alert("Por favor, configura las credenciales de YouTube primero.");
                  setShowSettings(true);
                  return;
                }
                window.location.href = "/api/auth";
              }}
              className={styles.connectBtn}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                <path d="M9 18c-4.51 2-5-2-7-2" />
              </svg>
              Conectar Canal
            </button>
          )}
        </div>
      </header>

      {/* Banner de Advertencias y Configuración */}
      {!config.isConfigured && (
        <div className={styles.warningBanner}>
          <div className={styles.warningContent}>
            <div className={styles.warningIcon}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div className={styles.warningText}>
              <h4>Credenciales no configuradas</h4>
              <p>
                Para subir y analizar videos, necesitas ingresar tu API Key de Gemini y tus
                claves OAuth de Google Cloud Console.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setConfigInput({
                GEMINI_API_KEY: "",
                YOUTUBE_CLIENT_ID: "",
                YOUTUBE_CLIENT_SECRET: "",
              });
              setShowSettings(true);
            }}
            className={styles.btnConfig}
          >
            Configurar Ahora
          </button>
        </div>
      )}

      {/* Selector de Pestañas */}
      {channel.connected && (
        <div className={styles.tabsContainer}>
          <button
            onClick={() => setActiveTab("upload")}
            className={`${styles.tabButton} ${activeTab === "upload" ? styles.tabActive : ""}`}
          >
            Subir y Programar Video
          </button>
          <button
            onClick={() => setActiveTab("optimize")}
            className={`${styles.tabButton} ${activeTab === "optimize" ? styles.tabActive : ""}`}
          >
            Optimizar Videos Existentes
          </button>
        </div>
      )}

      {activeTab === "upload" ? (
        /* Rejilla Principal */
        <div className={styles.dashboardGrid}>
          {/* Columna Izquierda: Subida / Formulario */}
          <div className={styles.mainCol}>
            {/* Tarjeta de Subida */}
            {uploadState.status === "idle" && (
              <div className={styles.card} style={{ position: "relative" }}>
                <div className={styles.cardTitle}>Subir Nuevo Video</div>

                {!config.isConfigured && (
                  <div className={styles.lockedOverlay}>
                    <svg
                      width="40"
                      height="40"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth="2"
                      style={{ marginBottom: "1rem" }}
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <h3 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Carga Deshabilitada</h3>
                    <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", maxWidth: "300px", marginBottom: "1rem" }}>
                      Debes configurar las credenciales en el botón superior antes de poder subir videos.
                    </p>
                    <button
                      onClick={() => setShowSettings(true)}
                      className={styles.btnConfig}
                    >
                      Ingresar Credenciales
                    </button>
                  </div>
                )}

                <div
                  className={styles.uploadArea}
                  onDragOver={handleDragOver}
                  onDrop={handleFileDrop}
                  onClick={triggerFileSelect}
                >
                  <div className={styles.uploadIcon}>
                    <svg
                      width="48"
                      height="48"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </div>
                  <div className={styles.uploadText}>
                    <h3>Arrastra y suelta tu video aquí</h3>
                    <p>o haz clic para explorar tus archivos locales</p>
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="video/*"
                    style={{ display: "none" }}
                    disabled={!config.isConfigured}
                  />
                </div>

                {/* Selección de Idioma */}
                <div className={styles.inputGroup} style={{ marginTop: "1.25rem" }}>
                  <label htmlFor="languageSelect">Idioma para los Metadatos (Títulos, Descripción y Tags)</label>
                  <select
                    id="languageSelect"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    <option value="Spanish" style={{ background: "var(--bg-surface-solid)", color: "var(--text-primary)" }}>Español</option>
                    <option value="English" style={{ background: "var(--bg-surface-solid)", color: "var(--text-primary)" }}>Inglés</option>
                    <option value="German" style={{ background: "var(--bg-surface-solid)", color: "var(--text-primary)" }}>Alemán</option>
                    <option value="French" style={{ background: "var(--bg-surface-solid)", color: "var(--text-primary)" }}>Francés</option>
                  </select>
                </div>
              </div>
            )}

            {/* Tarjeta de progreso de subida */}
            {uploadState.status === "uploading" && (
              <div className={styles.card}>
                <div className={styles.cardTitle}>Subiendo al Servidor Local</div>
                <div className={styles.progressContainer}>
                  <div className={styles.progressHeader}>
                    <span>Subiendo {uploadState.file?.name}</span>
                    <span>{uploadState.progress}%</span>
                  </div>
                  <div className={styles.progressBarOuter}>
                    <div
                      className={styles.progressBarInner}
                      style={{ width: `${uploadState.progress}%` }}
                    ></div>
                  </div>
                  <div
                    className={styles.progressHeader}
                    style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}
                  >
                    <span>Velocidad: {uploadState.speed}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Tarjeta de estado de análisis de IA */}
            {uploadState.status === "analyzing" && (
              <div className={styles.card}>
                <div className={styles.analyzingContainer}>
                  <div className={styles.pulseGlow}>
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                  </div>
                  <div className={styles.uploadText}>
                    <h3>Gemini IA está analizando tu video...</h3>
                    <p>
                      Procesando el contenido visual y auditivo para sugerir títulos,
                      descripción y hashtags óptimos. Esto puede tomar unos minutos para videos largos.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Estado de éxito */}
            {uploadState.status === "success" && (
              <div className={styles.card}>
                <div className={styles.analyzingContainer} style={{ padding: "2rem 1rem" }}>
                  <div
                    className={styles.pulseGlow}
                    style={{ background: "rgba(16, 185, 129, 0.15)", color: "var(--success)" }}
                  >
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <h3 style={{ color: "var(--success)" }}>¡Video Programado con Éxito!</h3>
                    <p style={{ marginTop: "0.5rem" }}>
                      El proceso de subida y programación se ha iniciado en segundo plano.
                      Puedes ver el progreso en la cola de la derecha.
                    </p>
                  </div>
                  <button
                    onClick={() => setUploadState({ ...uploadState, status: "idle" })}
                    className={styles.btnSubmit}
                    style={{ maxWidth: "200px", marginTop: "1rem" }}
                  >
                    Subir Otro Video
                  </button>
                </div>
              </div>
            )}

            {/* Estado de error */}
            {uploadState.status === "error" && (
              <div className={styles.card}>
                <div className={styles.analyzingContainer} style={{ padding: "2rem 1rem" }}>
                  <div
                    className={styles.pulseGlow}
                    style={{ background: "rgba(239, 68, 68, 0.15)", color: "var(--error)" }}
                  >
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </div>
                  <div>
                    <h3 style={{ color: "var(--error)" }}>Ocurrió un error</h3>
                    <p className={styles.errorText} style={{ marginTop: "0.5rem" }}>
                      {uploadState.errorMessage}
                    </p>
                  </div>
                  
                  {/* Botones de acción dinámicos según el tipo de fallo (Subida vs Análisis) */}
                  <div style={{ display: "flex", gap: "1rem", justifyContent: "center", width: "100%", flexWrap: "wrap", marginTop: "1.5rem" }}>
                    {uploadState.videoId ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setUploadState((prev) => ({ ...prev, status: "analyzing", errorMessage: "" }));
                            triggerAnalysis(uploadState.videoId, language);
                          }}
                          className={styles.btnSubmit}
                          style={{ width: "auto", minWidth: "160px" }}
                        >
                          Reintentar Análisis
                        </button>
                        <button
                          type="button"
                          onClick={() => setUploadState({ ...uploadState, status: "idle", videoId: "" })}
                          className={styles.btnCancel}
                          style={{ width: "auto", minWidth: "160px" }}
                        >
                          Subir Otro Video
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setUploadState({ ...uploadState, status: "idle" })}
                        className={styles.btnSubmit}
                        style={{ width: "auto", minWidth: "180px" }}
                      >
                        Reintentar Subida
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Formulario de Metadatos (Se muestra cuando el estado es 'ready') */}
            {uploadState.status === "ready" && (
              <form onSubmit={handleSubmitMetadata} className={styles.card}>
                <div className={styles.cardTitle}>Configurar y Programar Video</div>

                {extractedThumbnail && (
                  <div className={styles.inputGroup}>
                    <label>Miniatura de Portada Generada</label>
                    <img
                      src={extractedThumbnail}
                      alt="Miniatura de Portada"
                      style={{
                        width: "100%",
                        maxWidth: "320px",
                        borderRadius: "12px",
                        border: "1px solid var(--border-color)",
                        marginTop: "0.25rem",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.3)"
                      }}
                    />
                  </div>
                )}

                {/* Sugerencias de Título */}
                {metadata.titlesOptions.length > 0 && (
                  <div className={styles.titlesSuggestionGroup}>
                    <div className={styles.suggestionTitleLabel}>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      Títulos sugeridos por Gemini IA (Haz clic para seleccionar):
                    </div>
                    {metadata.titlesOptions.map((titleOpt, index) => (
                      <button
                        key={index}
                        type="button"
                        className={`${styles.titleSuggestionCard} ${metadata.selectedTitle === titleOpt ? styles.titleSuggestionActive : ""
                          }`}
                        onClick={() => setMetadata({ ...metadata, selectedTitle: titleOpt })}
                      >
                        {titleOpt}
                      </button>
                    ))}
                  </div>
                )}

                {/* Campos Editables */}
                <div className={styles.inputGroup}>
                  <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                    <span>Título Final</span>
                    <span style={{ fontSize: "0.75rem", fontWeight: "normal", color: metadata.selectedTitle.length >= 90 ? "#ef4444" : "var(--text-muted, #94a3b8)" }}>
                      {metadata.selectedTitle.length}/100
                    </span>
                  </label>
                  <textarea
                    rows="2"
                    required
                    maxLength={100}
                    value={metadata.selectedTitle}
                    onChange={(e) => setMetadata({ ...metadata, selectedTitle: e.target.value })}
                    placeholder="Introduce el título del video"
                    style={{ resize: "none" }}
                  />
                </div>

                <div className={styles.inputGroup}>
                  <label>Descripción</label>
                  <textarea
                    rows="8"
                    required
                    value={metadata.description}
                    onChange={(e) => setMetadata({ ...metadata, description: e.target.value })}
                    placeholder="Introduce la descripción del video"
                  />
                </div>

                <div className={styles.inputGroup}>
                  <label>Etiquetas (Separadas por comas)</label>
                  <textarea
                    rows="2"
                    value={metadata.tags}
                    onChange={(e) => setMetadata({ ...metadata, tags: e.target.value })}
                    placeholder="ia, youtube, tecnologia, automatizacion"
                    style={{ resize: "none" }}
                  />
                </div>

                {/* Detalles de Programación */}
                <div className={styles.inputGroup} style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    id="scheduleToggle"
                    checked={metadata.isScheduled}
                    onChange={(e) => setMetadata({ ...metadata, isScheduled: e.target.checked })}
                    style={{ width: "18px", height: "18px", cursor: "pointer" }}
                  />
                  <label htmlFor="scheduleToggle" style={{ cursor: "pointer", textTransform: "none" }}>
                    Programar publicación para una fecha futura
                  </label>
                </div>

                {metadata.isScheduled && (
                  <div className={styles.inputGroup}>
                    <label>Fecha y Hora de Publicación</label>
                    <input
                      type="datetime-local"
                      required={metadata.isScheduled}
                      value={metadata.scheduledAt}
                      onChange={(e) => setMetadata({ ...metadata, scheduledAt: e.target.value })}
                    />
                  </div>
                )}

                {/* Botones de Envío */}
                <button type="submit" disabled={isSubmitting || !channel.connected} className={styles.btnSubmit}>
                  {isSubmitting ? (
                    <>Procesando...</>
                  ) : (
                    <>
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="22 2 11 13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                      {metadata.isScheduled ? "Programar en YouTube" : "Subir Ahora"}
                    </>
                  )}
                </button>
                {!channel.connected && (
                  <p className={styles.errorText} style={{ marginTop: "0.5rem", textAlign: "center" }}>
                    Debes conectar un canal de YouTube antes de subir/programar.
                  </p>
                )}
              </form>
            )}
          </div>

          {/* Columna Derecha: Historial de Subida / Cola */}
          <div className={styles.sidebarCol}>
            <div className={styles.card}>
              <div className={styles.cardTitle}>
                Cola de Subida y Estado
                <button onClick={fetchVideos} className={styles.refreshBtn} title="Actualizar lista">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                </button>
              </div>

              <div className={styles.historyList}>
                {videosList.length === 0 ? (
                  <div className={styles.emptyState}>No hay videos registrados aún.</div>
                ) : (
                  videosList.map((video) => (
                    <div key={video.id} className={styles.historyItem}>
                      <div className={styles.historyItemContent}>
                        <div className={styles.historyThumbnailContainer}>
                          <img
                            src={`/api/videos/thumbnail?id=${video.id}`}
                            onError={(e) => {
                              e.target.parentNode.style.display = "none";
                            }}
                            alt="Miniatura"
                            className={styles.historyThumbnail}
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className={styles.historyHeader}>
                            <span className={styles.historyFilename}>{video.filename}</span>
                            <div className={styles.historyHeaderRight}>
                              <span className={`${styles.statusBadge} ${getStatusBadgeClass(video.status)}`}>
                                {getStatusText(video.status)}
                              </span>
                              <button onClick={() => handleEditVideo(video)} className={styles.historyActionBtn} title="Editar metadatos">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleDeleteVideo(video.id)}
                                className={deletingVideoId === video.id ? styles.historyActionBtnDeleteConfirm : styles.historyActionBtnDelete}
                                title={deletingVideoId === video.id ? "Haz clic de nuevo para confirmar (no afectará a YouTube)" : "Eliminar de la cola (no afectará a YouTube)"}
                              >
                                {deletingVideoId === video.id ? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                ) : (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </div>

                          <div className={styles.historyTitle}>
                            {video.title || "Procesando metadatos..."}
                          </div>

                          {video.errorMessage && (
                            <div className={styles.errorText}>{video.errorMessage}</div>
                          )}

                          {video.status === "UPLOADING" && (
                            <div className={styles.progressContainer} style={{ marginTop: "0.5rem" }}>
                              <div className={styles.progressHeader} style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                                <span>Progreso de subida</span>
                                <span>{video.uploadProgress || 0}%</span>
                              </div>
                              <div className={styles.progressBarOuter} style={{ height: "6px" }}>
                                <div
                                  className={styles.progressBarInner}
                                  style={{
                                    width: `${video.uploadProgress || 0}%`,
                                    height: "100%"
                                  }}
                                ></div>
                              </div>
                            </div>
                          )}

                          <div className={styles.historyMeta}>
                            <span>
                              {video.scheduledAt
                                ? `📅 Prog: ${formatDate(video.scheduledAt)}`
                                : "🚀 Inmediato"}
                            </span>
                            {video.youtubeId ? (
                              <a
                                href={`https://studio.youtube.com/video/${video.youtubeId}/edit`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.youtubeLink}
                              >
                                Ver en Studio
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                                </svg>
                              </a>
                            ) : (
                              <span>ID: {video.id.substring(0, 8)}...</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Diseño de Optimización de Videos Existentes */
        <div className={styles.mainCol}>
          <div className={styles.card}>
            <div className={styles.cardTitle}>Optimizar Videos Existentes en tu Canal</div>

            <div className={styles.searchContainer}>
              <input
                type="text"
                placeholder="Buscar video por título..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchYoutubeVideos(searchQuery)}
                style={{
                  flex: 1,
                  background: "rgba(0, 0, 0, 0.2)",
                  border: "1px solid var(--border-color)",
                  color: "var(--text-primary)",
                  borderRadius: "8px",
                  padding: "0.75rem 1rem",
                  fontFamily: "inherit",
                  fontSize: "0.95rem"
                }}
              />
              <button
                onClick={() => fetchYoutubeVideos(searchQuery)}
                className={styles.btnSubmit}
                style={{ width: "auto", padding: "0.75rem 1.5rem" }}
              >
                Buscar
              </button>
            </div>

            {loadingYoutubeVideos ? (
              <div className={styles.emptyState}>Cargando videos de tu canal...</div>
            ) : youtubeVideos.length === 0 ? (
              <div className={styles.emptyState}>No se encontraron videos.</div>
            ) : (
              <div className={styles.youtubeVideosGrid}>
                {youtubeVideos.map((video) => (
                  <Fragment key={video.id}>
                    <div
                      onClick={() => {
                        setSelectedYoutubeVideo(video);
                        setUpdateForm({ title: video.title, description: video.description, tags: video.tags || "", isScheduled: false, scheduledAt: "" });
                        setOptimizationSuggestions(null);
                        setNewThumbnailBase64(null);
                      }}
                      className={`${styles.youtubeVideoCard} ${selectedYoutubeVideo?.id === video.id ? styles.youtubeVideoCardActive : ""}`}
                    >
                      <img src={video.thumbnail} alt={video.title} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover" }} />
                      <div style={{ padding: "0.75rem" }}>
                        <h4 style={{ fontSize: "0.85rem", fontWeight: "600", color: "var(--text-primary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", height: "2.4rem", lineHeight: "1.2rem" }}>
                          {video.title}
                        </h4>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
                          {new Date(video.publishedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {selectedYoutubeVideo?.id === video.id && (
                      <form onSubmit={handleSaveYoutubeVideoChanges} className={styles.inlineEditPanel}>
                        <div className={styles.inlineEditHeader}>
                          <h3>⚡ Optimizar Video con IA</h3>
                          <button type="button" onClick={() => {
                            setSelectedYoutubeVideo(null);
                            setOptimizationSuggestions(null);
                            setNewThumbnailBase64(null);
                          }} className={styles.closeBtn}>✕</button>
                        </div>

                        <div className={styles.inlineEditContent}>
                          {/* Columna Izquierda: Detalles visuales y sugerencias de IA */}
                          <div className={styles.inlineEditColLeft}>
                            <div className={styles.selectedVideoPreview}>
                              <img src={selectedYoutubeVideo.thumbnail} alt="Selected thumbnail" className={styles.selectedVideoThumbnail} />
                              <div className={styles.selectedVideoInfo}>
                                <h5 style={{ fontSize: "0.85rem", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, width: "100%" }}>{selectedYoutubeVideo.title}</h5>
                                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word", minWidth: 0, width: "100%" }}>{selectedYoutubeVideo.description}</p>
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={optimizingVideo}
                              onClick={() => handleOptimizeVideo(selectedYoutubeVideo.id)}
                              className={styles.btnSubmit}
                              style={{ background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", boxShadow: "0 4px 15px rgba(168, 85, 247, 0.3)" }}
                            >
                              {optimizingVideo ? "Optimizando con Gemini..." : "⚡ Optimizar con Gemini IA"}
                            </button>

                            {optimizationSuggestions && (
                              <div className={styles.titlesSuggestionGroup} style={{ marginTop: "0.5rem" }}>
                                <div className={styles.suggestionTitleLabel}>
                                  ✏️ Títulos sugeridos por la IA:
                                </div>
                                {optimizationSuggestions.titles.map((t, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setUpdateForm({ ...updateForm, title: t })}
                                    className={`${styles.titleSuggestionCard} ${updateForm.title === t ? styles.titleSuggestionActive : ""}`}
                                    style={{ fontSize: "0.8rem", padding: "0.6rem 0.8rem" }}
                                  >
                                    {t}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Columna Derecha: Campos editables y acción de guardar */}
                          <div className={styles.inlineEditColRight}>
                            <div className={styles.inputGroup}>
                              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                                <span>Título Final en YouTube</span>
                                <span style={{ fontSize: "0.75rem", fontWeight: "normal", color: updateForm.title.length >= 90 ? "#ef4444" : "var(--text-muted, #94a3b8)" }}>
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
                              <label>Descripción</label>
                              <textarea
                                rows="6"
                                required
                                value={updateForm.description}
                                onChange={(e) => setUpdateForm({ ...updateForm, description: e.target.value })}
                              />
                            </div>

                            <div className={styles.inputGroup}>
                              <label>Etiquetas (separadas por comas)</label>
                              <textarea
                                rows="2"
                                value={updateForm.tags}
                                onChange={(e) => setUpdateForm({ ...updateForm, tags: e.target.value })}
                                placeholder="ia, youtube, optimizado"
                                style={{ resize: "none" }}
                              />
                            </div>

                            <div className={styles.inputGroup}>
                              <label>Nueva Portada / Miniatura (Opcional)</label>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={handleNewThumbnailSelect}
                                style={{ background: "transparent", border: "none", padding: 0 }}
                              />
                              {selectedYoutubeVideo?.isShort && (
                                <div style={{ fontSize: "0.75rem", color: "var(--warning, #f59e0b)", marginTop: "0.5rem", display: "flex", gap: "0.25rem", alignItems: "center" }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                    <line x1="12" y1="9" x2="12" y2="13" />
                                    <line x1="12" y1="17" x2="12.01" y2="17" />
                                  </svg>
                                  <span>YouTube no permite portadas personalizadas para Shorts (videos de menos de 60s) desde la API o la web de Studio de escritorio.</span>
                                </div>
                              )}
                              {newThumbnailBase64 && (
                                <div style={{ marginTop: "0.5rem", position: "relative" }}>
                                  <img src={newThumbnailBase64} alt="New preview" style={{ width: "100%", maxWidth: "160px", borderRadius: "8px", border: "1px solid var(--border-color)" }} />
                                  <button type="button" onClick={() => setNewThumbnailBase64(null)} style={{ position: "absolute", top: "-5px", left: "145px", background: "#ef4444", color: "#fff", border: "none", borderRadius: "50%", width: "20px", height: "20px", cursor: "pointer", fontSize: "10px", padding: 0 }}>✕</button>
                                </div>
                              )}
                            </div>

                            <div className={styles.inputGroup} style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem", marginTop: "1rem" }}>
                              <input
                                type="checkbox"
                                id="optimizeScheduleToggle"
                                checked={updateForm.isScheduled}
                                onChange={(e) => setUpdateForm({ ...updateForm, isScheduled: e.target.checked })}
                                style={{ width: "18px", height: "18px", cursor: "pointer" }}
                              />
                              <label htmlFor="optimizeScheduleToggle" style={{ cursor: "pointer", textTransform: "none", fontSize: "0.9rem" }}>
                                Programar cambios para una fecha futura
                              </label>
                            </div>

                            {updateForm.isScheduled && (
                              <div className={styles.inputGroup} style={{ marginTop: "1rem" }}>
                                <label>Fecha y Hora de Actualización</label>
                                <input
                                  type="datetime-local"
                                  required={updateForm.isScheduled}
                                  value={updateForm.scheduledAt}
                                  onChange={(e) => setUpdateForm({ ...updateForm, scheduledAt: e.target.value })}
                                />
                              </div>
                            )}

                            <div className={styles.inlineEditActions}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedYoutubeVideo(null);
                                  setOptimizationSuggestions(null);
                                  setNewThumbnailBase64(null);
                                }}
                                className={styles.btnCancel}
                                style={{ flex: 1 }}
                              >
                                Cancelar
                              </button>
                              <button
                                type="submit"
                                disabled={updatingYoutubeVideo}
                                className={styles.btnSubmit}
                                style={{ flex: 1.5 }}
                              >
                                {updatingYoutubeVideo ? "Guardando..." : updateForm.isScheduled ? "Programar Cambios" : "Guardar en YouTube"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </form>
                    )}
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Configuración */}
      {showSettings && (
        <div className={styles.settingsOverlay}>
          <form onSubmit={handleSaveConfig} className={styles.settingsModal}>
            <div className={styles.settingsHeader}>
              <h2>Configurar Credenciales de Empresa</h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className={styles.closeBtn}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className={styles.inputGroup}>
              <label>Gemini API Key</label>
              <input
                type="password"
                autoComplete="new-password"
                value={configInput.GEMINI_API_KEY}
                onChange={(e) =>
                  setConfigInput({ ...configInput, GEMINI_API_KEY: e.target.value })
                }
                placeholder={config.GEMINI_API_KEY ? `${config.GEMINI_API_KEY} (Configurada)` : "Pega tu API Key de Gemini"}
              />
              <span className={styles.configOverlayInfo}>
                Obtenida en Google AI Studio. Usada para el análisis de video.
              </span>
            </div>

            <div className={styles.inputGroup}>
              <label>Google OAuth Client ID</label>
              <input
                type="text"
                value={configInput.YOUTUBE_CLIENT_ID}
                onChange={(e) =>
                  setConfigInput({ ...configInput, YOUTUBE_CLIENT_ID: e.target.value })
                }
                placeholder={config.YOUTUBE_CLIENT_ID ? `${config.YOUTUBE_CLIENT_ID} (Configurado)` : "123456-abcdef.apps.googleusercontent.com"}
              />
              <span className={styles.configOverlayInfo}>
                Creado en Google Cloud Console para la API de YouTube.
              </span>
            </div>

            <div className={styles.inputGroup}>
              <label>Google OAuth Client Secret</label>
              <input
                type="password"
                autoComplete="new-password"
                value={configInput.YOUTUBE_CLIENT_SECRET}
                onChange={(e) =>
                  setConfigInput({ ...configInput, YOUTUBE_CLIENT_SECRET: e.target.value })
                }
                placeholder={config.YOUTUBE_CLIENT_SECRET ? `${config.YOUTUBE_CLIENT_SECRET} (Configurado)` : "Pega el Secreto de Cliente OAuth"}
              />
              <span className={styles.configOverlayInfo}>
                Secreto asociado al Client ID de Google Cloud.
              </span>
            </div>

            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: "1.4" }}>
              * Nota: Si dejas algún campo vacío y ya estaba configurado, se conservará el valor anterior.
              Toda la información se guarda en la base de datos compartida y estará disponible para el equipo.
            </p>

            <div className={styles.settingsActions}>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className={styles.btnCancel}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingConfig}
                className={styles.btnSubmit}
                style={{ width: "auto" }}
              >
                {savingConfig ? "Guardando..." : "Guardar Cambios"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Edición de Video */}
      {editingVideo && (
        <div className={styles.settingsOverlay}>
          <form onSubmit={handleUpdateVideo} className={styles.settingsModal} style={{ maxWidth: "600px" }}>
            <div className={styles.settingsHeader}>
              <h2>Editar Video en Cola</h2>
              <button
                type="button"
                onClick={() => setEditingVideo(null)}
                className={styles.closeBtn}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className={styles.inputGroup}>
              <label>Archivo Original</label>
              <input type="text" disabled value={editingVideo.filename} style={{ opacity: 0.6 }} />
            </div>

            <div className={styles.inputGroup} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img
                src={`/api/videos/thumbnail?id=${editingVideo.id}`}
                onError={(e) => {
                  e.target.style.display = "none";
                }}
                alt="Miniatura"
                style={{ width: "100%", maxWidth: "240px", borderRadius: "8px", border: "1px solid var(--border-color)", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}
              />
            </div>

            <div className={styles.inputGroup}>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                <span>Título</span>
                <span style={{ fontSize: "0.75rem", fontWeight: "normal", color: editForm.title.length >= 90 ? "#ef4444" : "var(--text-muted, #94a3b8)" }}>
                  {editForm.title.length}/100
                </span>
              </label>
              <textarea
                rows="2"
                required
                maxLength={100}
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                placeholder="Título del video"
                style={{ resize: "none" }}
              />
            </div>

            <div className={styles.inputGroup}>
              <label>Descripción</label>
              <textarea
                rows="5"
                required
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="Descripción del video"
              />
            </div>

            <div className={styles.inputGroup}>
              <label>Etiquetas (separadas por comas)</label>
              <textarea
                rows="2"
                value={editForm.tags}
                onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                placeholder="ia, youtube, tags"
                style={{ resize: "none" }}
              />
            </div>

            <div className={styles.inputGroup}>
              <label>Estado</label>
              <select
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
              >
                <option value="DRAFT" style={{ background: "var(--bg-surface-solid)", color: "var(--text-primary)" }}>Borrador (DRAFT)</option>
                <option value="ANALYZING" style={{ background: "var(--bg-surface-solid)", color: "var(--text-primary)" }}>Analizando con IA (ANALYZING)</option>
                <option value="READY" style={{ background: "var(--bg-surface-solid)", color: "var(--text-primary)" }}>Listo para Programar (READY)</option>
                <option value="UPLOADING" style={{ background: "var(--bg-surface-solid)", color: "var(--text-primary)" }}>Subiendo a YouTube (UPLOADING)</option>
                <option value="SCHEDULED" style={{ background: "var(--bg-surface-solid)", color: "var(--text-primary)" }}>Programado (SCHEDULED)</option>
                <option value="COMPLETED" style={{ background: "var(--bg-surface-solid)", color: "var(--text-primary)" }}>Publicado (COMPLETED)</option>
                <option value="FAILED" style={{ background: "var(--bg-surface-solid)", color: "var(--text-primary)" }}>Fallido (FAILED)</option>
              </select>
            </div>

            <div className={styles.inputGroup} style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                id="editScheduleToggle"
                checked={editForm.isScheduled}
                onChange={(e) => setEditForm({ ...editForm, isScheduled: e.target.checked })}
                style={{ width: "18px", height: "18px", cursor: "pointer" }}
              />
              <label htmlFor="editScheduleToggle" style={{ cursor: "pointer", textTransform: "none" }}>
                Programar publicación para una fecha futura
              </label>
            </div>

            {editForm.isScheduled && (
              <div className={styles.inputGroup}>
                <label>Fecha y Hora de Publicación</label>
                <input
                  type="datetime-local"
                  required={editForm.isScheduled}
                  value={editForm.scheduledAt}
                  onChange={(e) => setEditForm({ ...editForm, scheduledAt: e.target.value })}
                />
              </div>
            )}

            <div className={styles.settingsActions}>
              <button
                type="button"
                onClick={() => setEditingVideo(null)}
                className={styles.btnCancel}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isUpdatingVideo}
                className={styles.btnSubmit}
                style={{ width: "auto" }}
              >
                {isUpdatingVideo ? "Guardando..." : "Guardar Cambios"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
