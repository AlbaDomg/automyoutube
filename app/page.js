"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import styles from "./page.module.css";
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

// Helper para encontrar el logotipo ideal basado en el nombre de la lista de reproducción
function findBestLogoForPlaylist(playlistTitle, logosCatalog) {
  if (!playlistTitle || !logosCatalog || logosCatalog.length === 0) return "none";
  
  const cleanPl = playlistTitle.toUpperCase().replace(/_/g, " ").trim();
  const slugPl = slugify(cleanPl);
  const normPl = slugPl.replace(/hola/g, "hora");
  
  // Fase 1: Coincidencia exacta
  let best = logosCatalog.find(logo => {
    const cleanLogo = logo.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
    if (cleanPl === cleanLogo) return true;
    
    const slugLogo = slugify(cleanLogo);
    const normLogo = slugLogo.replace(/hola/g, "hora");
    return normPl === normLogo;
  });
  
  if (best) return best;
  
  // Fase 2: El nombre de la playlist contiene el logotipo del programa
  best = logosCatalog.find(logo => {
    const cleanLogo = logo.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
    const slugLogo = slugify(cleanLogo);
    const normLogo = slugLogo.replace(/hola/g, "hora");
    return normLogo.length > 2 && normPl.includes(normLogo);
  });
  
  if (best) return best;

  // Fase 3: El logotipo del programa contiene el nombre de la playlist
  best = logosCatalog.find(logo => {
    const cleanLogo = logo.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
    const slugLogo = slugify(cleanLogo);
    const normLogo = slugLogo.replace(/hola/g, "hora");
    return normPl.length > 2 && normLogo.includes(normPl);
  });
  
  return best || "none";
}

// Helper para actualizar el sufijo de programa del título
function updateTitleSuffix(title, programName) {
  let cleanTitle = (title || "").trim();
  const suffixRegex = /\s*\|\s*[a-zA-Z0-9_\sÀ-ÿ\-]+$/i;
  cleanTitle = cleanTitle.replace(suffixRegex, "").trim();
  
  if (programName && programName !== "none") {
    const cleanProg = programName.replace(/\.[^/.]+$/, "").replace(/_/g, " ").toUpperCase().trim();
    cleanTitle = `${cleanTitle} | ${cleanProg}`;
  }
  return cleanTitle;
}

// Helper para actualizar la URL de programa y asegurar la presencia del bloque social en la descripción
function updateDescriptionUrl(description, programName) {
  let slug = "horagalega";
  if (programName && programName !== "none") {
    const cleanProg = programName.replace(/\.[^/.]+$/, "").replace(/_/g, " ").trim();
    slug = slugify(cleanProg);
  }
  
  const descStr = (description || "").trim();
  
  // Si ya tiene el bloque de redes sociales o un enlace de tvg.gal, solo nos aseguramos de que el link de tvg.gal/slug esté actualizado
  if (descStr.includes("seguirnos en todas as nosas redes sociais") || descStr.includes("tvg.gal/")) {
    const urlRegex = /tvg\.gal\/[a-z0-9]+/gi;
    if (urlRegex.test(descStr)) {
      return descStr.replace(urlRegex, `tvg.gal/${slug}`);
    }
    return descStr;
  }
  
  // Si no tiene el bloque de redes sociales, se lo añadimos con el slug correspondiente
  const socialBlock = `\n\nPodes ver o programa completo en tvg.gal/${slug}\n\n🔔 Subscríbete á canle oficial da Televisión de Galicia en YouTube: https://www.youtube.com/tvg\n\n🌐 Visita a nosa páxina web: https://agalega.gal/\n\n📲 E tamén podes seguirnos en todas as nosas redes sociais:\nFacebook: https://www.facebook.com/televisiondegalicia\nTwitter: https://x.com/tvgalicia\nInstagram: https://www.instagram.com/tvgalicia\nTikTok: https://www.tiktok.com/@tvgalicia`;
  
  return descStr ? `${descStr}${socialBlock}` : socialBlock.trim();
}

// Helper para renderizar la descripción con vista previa de enlaces de redes (pills) estilo YouTube
function renderDescriptionPreview(text) {
  if (!text) return null;
  const lines = text.split("\n");
  
  return lines.map((line, idx) => {
    // Buscar enlaces de redes sociales oficiales
    const fbMatch = line.match(/^Facebook:\s*(https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9_\-\.]+)\/?)/i);
    const twMatch = line.match(/^(?:Twitter|X):\s*(https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([a-zA-Z0-9_\-\.]+)\/?)/i);
    const igMatch = line.match(/^Instagram:\s*(https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_\-\.]+)\/?)/i);
    const ttMatch = line.match(/^TikTok:\s*(https?:\/\/(?:www\.)?tiktok\.com\/@?([a-zA-Z0-9_\-\.]+)\/?)/i);
    const ytSubMatch = line.match(/^(🔔\s*Subscríbete\s+[^:]+):\s*(https?:\/\/[^\s]+)/i);
    const webMatch = line.match(/^(🌐\s*Visita\s+[^:]+):\s*(https?:\/\/[^\s]+)/i);
    const generalUrlMatch = line.match(/^(Podes\s+ver\s+[^:]+):\s*(https?:\/\/[^\s]+)/i);

    const pillStyle = {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      background: "rgba(255, 255, 255, 0.08)",
      border: "1px solid rgba(255, 255, 255, 0.15)",
      borderRadius: "16px",
      padding: "3px 12px",
      fontSize: "0.8rem",
      color: "#f1f5f9",
      textDecoration: "none",
      marginLeft: "6px",
      verticalAlign: "middle",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
    };

    const labelStyle = {
      fontWeight: "500",
      color: "#94a3b8"
    };

    if (fbMatch) {
      const url = fbMatch[1];
      const username = fbMatch[2];
      return (
        <div key={idx} style={{ marginBottom: "6px" }}>
          <span style={labelStyle}>Facebook: </span>
          <a href={url} target="_blank" rel="noopener noreferrer" style={pillStyle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#1877f2" style={{ display: "inline-block", verticalAlign: "middle" }}>
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
            <span style={{ fontSize: "0.75rem", opacity: 0.9 }}>/ {username}</span>
          </a>
        </div>
      );
    }

    if (twMatch) {
      const url = twMatch[1];
      const username = twMatch[2];
      return (
        <div key={idx} style={{ marginBottom: "6px" }}>
          <span style={labelStyle}>Twitter: </span>
          <a href={url} target="_blank" rel="noopener noreferrer" style={pillStyle}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#ffffff" style={{ display: "inline-block", verticalAlign: "middle" }}>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            <span style={{ fontSize: "0.75rem", opacity: 0.9 }}>/ {username}</span>
          </a>
        </div>
      );
    }

    if (igMatch) {
      const url = igMatch[1];
      const username = igMatch[2];
      return (
        <div key={idx} style={{ marginBottom: "6px" }}>
          <span style={labelStyle}>Instagram: </span>
          <a href={url} target="_blank" rel="noopener noreferrer" style={pillStyle}>
            <svg width="14" height="14" viewBox="0 0 24 24" style={{ display: "inline-block", verticalAlign: "middle" }}>
              <defs>
                <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#f09433" />
                  <stop offset="25%" stopColor="#e6683c" />
                  <stop offset="50%" stopColor="#dc2743" />
                  <stop offset="75%" stopColor="#cc2366" />
                  <stop offset="100%" stopColor="#bc1888" />
                </linearGradient>
              </defs>
              <path fill="url(#ig-grad)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.051.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
            </svg>
            <span style={{ fontSize: "0.75rem", opacity: 0.9 }}>/ {username}</span>
          </a>
        </div>
      );
    }

    if (ttMatch) {
      const url = ttMatch[1];
      const username = ttMatch[2];
      return (
        <div key={idx} style={{ marginBottom: "6px" }}>
          <span style={labelStyle}>TikTok: </span>
          <a href={url} target="_blank" rel="noopener noreferrer" style={pillStyle}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#ffffff" style={{ display: "inline-block", verticalAlign: "middle" }}>
              <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.17-2.86-.74-3.95-1.72-.1.65-.18 1.3-.19 1.96-.02 2.64-.78 5.24-2.52 7.22-1.7 1.97-4.22 3.14-6.83 3.13-2.92.05-5.83-1.38-7.39-3.88-1.61-2.52-1.76-5.83-.4-8.48 1.25-2.48 3.73-4.14 6.5-4.41V7.99c-1.7.19-3.27 1.13-4.04 2.67-.84 1.63-.76 3.67.23 5.2 1.01 1.58 2.89 2.52 4.77 2.37 1.83-.08 3.53-1.23 4.13-2.97.47-1.31.43-2.73.44-4.1V.02z"/>
            </svg>
            <span style={{ fontSize: "0.75rem", opacity: 0.9 }}>/ {username}</span>
          </a>
        </div>
      );
    }

    if (ytSubMatch) {
      const text = ytSubMatch[1];
      const url = ytSubMatch[2];
      return (
        <div key={idx} style={{ marginBottom: "6px" }}>
          <span style={labelStyle}>{text}: </span>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#38bdf8", textDecoration: "none" }}>{url}</a>
        </div>
      );
    }

    if (webMatch) {
      const text = webMatch[1];
      const url = webMatch[2];
      return (
        <div key={idx} style={{ marginBottom: "6px" }}>
          <span style={labelStyle}>{text}: </span>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#38bdf8", textDecoration: "none" }}>{url}</a>
        </div>
      );
    }

    if (generalUrlMatch) {
      const text = generalUrlMatch[1];
      const url = generalUrlMatch[2];
      return (
        <div key={idx} style={{ marginBottom: "6px" }}>
          <span style={{ color: "var(--text-main)" }}>{text}: </span>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#38bdf8", textDecoration: "none" }}>{url}</a>
        </div>
      );
    }

    return <div key={idx} style={{ minHeight: "1.2em" }}>{line}</div>;
  });
}

export default function Dashboard() {
  // Estados de autenticación de la aplicación (Google Sign-In)
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authError, setAuthError] = useState("");

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
  const [searchTitle, setSearchTitle] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [documentFile, setDocumentFile] = useState(null);
  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);
  const [logoUploadProgress, setLogoUploadProgress] = useState(null);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [parsedVideos, setParsedVideos] = useState([]);
  const [privateVideos, setPrivateVideos] = useState([]);
  const [isSyncingBatch, setIsSyncingBatch] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, status: "" });
  const [autoIncrement, setAutoIncrement] = useState(true);

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
  const [loadingYoutubeVideo, setLoadingYoutubeVideo] = useState(false);

  // Sugerencias de la IA (Títulos/Miniatura)
  const [optimizationSuggestions, setOptimizationSuggestions] = useState(null);
  const [isGeneratingSeoPhrase, setIsGeneratingSeoPhrase] = useState(false);
  const [generatingSeoIndex, setGeneratingSeoIndex] = useState({});

  // Estado de la cola de actualizaciones programadas locales
  const [scheduledUpdates, setScheduledUpdates] = useState([]);
  const [executingScheduler, setExecutingScheduler] = useState(false);

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

  const canvasRef = useRef(null);
  const templateImageRef = useRef(null);
  const defaultProgramLogoCanvasRef = useRef(null);
  const maskedTvgLogoCanvasRef = useRef(null);
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
    setSelectedProgramLogo("none");
    setCustomBgBase64(null);
    setIsAutoThumbnailEnabled(false);
    setNewThumbnailBase64(null);
  };

  // Helper para obtener el logotipo asociado a una playlist
  const getMatchedLogoForPlaylist = (playlistId) => {
    if (!playlistId || playlistId === "") return "none";
    const playlist = playlists.find(pl => pl.id === playlistId);
    if (!playlist) return "none";
    return findBestLogoForPlaylist(playlist.title, programLogosCatalog);
  };

  // Cambiar playlist y actualizar automáticamente logotipo, título y descripción en el editor individual
  const handleSinglePlaylistChange = (playlistId) => {
    const matchedLogo = getMatchedLogoForPlaylist(playlistId);
    setSelectedProgramLogo(matchedLogo);
    setUpdateForm(prev => ({
      ...prev,
      playlistId: playlistId,
      title: updateTitleSuffix(prev.title, matchedLogo),
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

  // Cambiar logo en el editor individual (solo cambia el logo, no toca título/descripción/playlist)
  const handleLogoChange = (logoVal) => {
    setSelectedProgramLogo(logoVal);
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
        setProgramLogosCatalog(data.logos);

        // Auto-subir Hora_Galega.png si no está en el catálogo y el canvas ya está listo
        if (!data.logos.includes("Hora_Galega.png") && defaultProgramLogoCanvasRef.current) {
          const canvas = defaultProgramLogoCanvasRef.current;
          canvas.toBlob(async (blob) => {
            if (!blob) return;
            const fileToUpload = new File([blob], "Hora_Galega.png", { type: "image/png" });
            const formData = new FormData();
            formData.append("file", fileToUpload);
            try {
              const uploadRes = await fetch("/api/program-logos", {
                method: "POST",
                body: formData,
              });
              if (uploadRes.ok) {
                console.log("[Auto-uploader] Hora_Galega.png subido al catálogo con éxito.");
                const refetchRes = await fetch("/api/program-logos", { cache: "no-store" });
                const refetchData = await refetchRes.json();
                if (refetchData.logos) {
                  setProgramLogosCatalog(refetchData.logos);
                }
              }
            } catch (uploadErr) {
              console.error("[Auto-uploader] Error al subir Hora_Galega.png:", uploadErr);
            }
          }, "image/png");
        }
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

  // Cargar preferencia de logotipo persistida en localStorage al seleccionar un vídeo
  useEffect(() => {
    if (selectedYoutubeVideo) {
      const cleanId = extractYoutubeId(selectedYoutubeVideo.id || selectedYoutubeVideo.youtubeId);
      if (cleanId) {
        const saved = localStorage.getItem(`prog_logo_${cleanId}`);
        if (saved) {
          setSelectedProgramLogo(saved);
        } else {
          // Auto-detectar del título o descripción
          const title = selectedYoutubeVideo.title || "";
          const desc = selectedYoutubeVideo.description || "";
          
          // Buscar sufijo del título: "| NOMBRE"
          const suffixMatch = title.match(/\|\s*([a-zA-Z0-9_\sÀ-ÿ\-]+)$/);
          let detectedProg = "";
          if (suffixMatch) {
            detectedProg = suffixMatch[1].toUpperCase().trim();
          } else {
            // Buscar en la descripción: tvg.gal/slug
            const descMatch = desc.match(/tvg\.gal\/([a-z0-9]+)/i);
            if (descMatch) {
              const slug = descMatch[1].toLowerCase();
              if (slug !== "horagalega") {
                detectedProg = slug.toUpperCase();
              }
            }
          }
          
          if (detectedProg) {
            const found = programLogosCatalog.find(logo => {
              const cleanLogoName = logo.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
              const slugLogo = slugify(cleanLogoName);
              const slugProg = slugify(detectedProg);
              return (
                cleanLogoName === detectedProg ||
                slugLogo === slugProg ||
                (slugLogo.length > 3 && slugProg.includes(slugLogo)) ||
                (slugProg.length > 3 && slugLogo.includes(slugProg))
              );
            });
            if (found) {
              setSelectedProgramLogo(found);
            } else if (detectedProg === "HORA GALEGA") {
              setSelectedProgramLogo("Hora_Galega.png");
            } else {
              setSelectedProgramLogo("none");
            }
          } else {
            setSelectedProgramLogo("none");
          }
        }
      } else {
        setSelectedProgramLogo("none");
      }
    }
  }, [selectedYoutubeVideo, programLogosCatalog]);

  // Persistir la selección de logotipo en localStorage ante cambios
  useEffect(() => {
    if (selectedYoutubeVideo && selectedProgramLogo) {
      const cleanId = extractYoutubeId(selectedYoutubeVideo.id || selectedYoutubeVideo.youtubeId);
      if (cleanId) {
        localStorage.setItem(`prog_logo_${cleanId}`, selectedProgramLogo);
      }
    }
  }, [selectedProgramLogo, selectedYoutubeVideo]);



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
          bgImg = await loadImage(customBgVal);
        } else {
          const cleanUrl = getCleanVideoFrameUrl(videoVal?.thumbnail, videoVal?.id);
          if (cleanUrl) {
            const proxiedUrl = `/api/youtube/thumbnail-proxy?url=${encodeURIComponent(cleanUrl)}`;
            bgImg = await loadImage(proxiedUrl);
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
  const regenerateThumbnailForIndex = async (index, updatedFields = {}) => {
    setParsedVideos(prev => {
      const list = [...prev];
      const idx = list.findIndex(v => v.index === index);
      if (idx === -1) return prev;

      const current = { ...list[idx], ...updatedFields };

      // Si la miniatura automática está desactivada, o si estamos estableciendo una miniatura manual directamente,
      // no debemos sobreescribirla con la generación automática.
      if (!current.isAutoThumbnailEnabled || ('generatedThumbnailBase64' in updatedFields && !current.isAutoThumbnailEnabled)) {
        list[idx] = current;
        return list;
      }

      const matchedVideo = privateVideos.find(pv => pv.id === current.matchedVideoId);

      generateSingleAutoThumbnail(
        current.thumbnailText,
        matchedVideo,
        current.customBgBase64,
        current.selectedProgramLogo
      ).then(thumbBase64 => {
        setParsedVideos(latest => {
          const latestList = [...latest];
          const targetIdx = latestList.findIndex(v => v.index === index);
          if (targetIdx !== -1) {
            // Solo sobreescribimos si sigue estando activada la miniatura automática
            if (latestList[targetIdx].isAutoThumbnailEnabled) {
              latestList[targetIdx].generatedThumbnailBase64 = thumbBase64 || "";
            }
          }
          return latestList;
        });
      });

      list[idx] = current;
      return list;
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
        const data = await res.json();
        setScheduledUpdates(data.filter(v => v.status === "SCHEDULED" || v.status === "UPLOADING"));
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

  // Buscar videos en YouTube por título (o ID/URL como fallback)
  const fetchYoutubeVideosByTitle = async (qVal) => {
    if (!qVal || !qVal.trim()) return;
    setLoadingYoutubeVideo(true);
    setSearchResults([]);
    try {
      const res = await fetch(`/api/youtube/videos?q=${encodeURIComponent(qVal)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data);
        if (data.length === 0) {
          alert("No se encontraron videos privados u ocultos con ese término de búsqueda.");
        }
      } else {
        const errData = await res.json();
        alert("Fallo al buscar videos: " + (errData.error || "error desconocido"));
      }
    } catch (err) {
      console.error("Error al buscar videos:", err);
      alert("Error de red al consultar los videos.");
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

    // Auto-detectar programa para inicializar con la descripción con el bloque social correcto
    let detectedProg = "none";
    const cleanId = extractYoutubeId(video.id);
    if (cleanId) {
      const saved = localStorage.getItem(`prog_logo_${cleanId}`);
      if (saved) {
        detectedProg = saved;
      } else {
        const title = video.title || "";
        const desc = video.description || "";
        const suffixMatch = title.match(/\|\s*([a-zA-Z0-9_\sÀ-ÿ\-]+)$/);
        if (suffixMatch) {
          detectedProg = suffixMatch[1].toUpperCase().trim();
        } else {
          const descMatch = desc.match(/tvg\.gal\/([a-z0-9]+)/i);
          if (descMatch) {
            const slug = descMatch[1].toLowerCase();
            if (slug !== "horagalega") {
              detectedProg = slug.toUpperCase();
            }
          }
        }
        if (detectedProg !== "none") {
          const found = programLogosCatalog.find(logo => {
            const cleanLogoName = logo.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
            const slugLogo = slugify(cleanLogoName);
            const slugProg = slugify(detectedProg);
            return (
              cleanLogoName === detectedProg ||
              slugLogo === slugProg ||
              (slugLogo.length > 3 && slugProg.includes(slugLogo)) ||
              (slugProg.length > 3 && slugLogo.includes(slugProg))
            );
          });
          if (found) {
            detectedProg = found;
          } else if (detectedProg === "HORA GALEGA") {
            detectedProg = "Hora_Galega.png";
          } else {
            detectedProg = "none";
          }
        }
      }
    }
    
    setUpdateForm({
      title: video.title || "",
      description: updateDescriptionUrl(video.description || "", detectedProg),
      tags: video.tags || "",
      isScheduled: !!scheduledUpdate,
      scheduledAt: scheduledUpdate && scheduledUpdate.scheduledAt 
        ? toLocalDateTimeString(scheduledUpdate.scheduledAt) 
        : "",
      playlistId: scheduledUpdate && scheduledUpdate.playlistId ? scheduledUpdate.playlistId : ""
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

        // Auto-detectar programa para inicializar con la descripción con el bloque social correcto
        let detectedProg = "none";
        const cleanId = extractYoutubeId(task.youtubeId);
        if (cleanId) {
          const saved = localStorage.getItem(`prog_logo_${cleanId}`);
          if (saved) {
            detectedProg = saved;
          } else {
            const title = task.title || video.title || "";
            const desc = task.description || video.description || "";
            const suffixMatch = title.match(/\|\s*([a-zA-Z0-9_\sÀ-ÿ\-]+)$/);
            if (suffixMatch) {
              detectedProg = suffixMatch[1].toUpperCase().trim();
            } else {
              const descMatch = desc.match(/tvg\.gal\/([a-z0-9]+)/i);
              if (descMatch) {
                const slug = descMatch[1].toLowerCase();
                if (slug !== "horagalega") {
                  detectedProg = slug.toUpperCase();
                }
              }
            }
            if (detectedProg !== "none") {
              const found = programLogosCatalog.find(logo => {
                const cleanLogoName = logo.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
                const slugLogo = slugify(cleanLogoName);
                const slugProg = slugify(detectedProg);
                return (
                  cleanLogoName === detectedProg ||
                  slugLogo === slugProg ||
                  (slugLogo.length > 3 && slugProg.includes(slugLogo)) ||
                  (slugProg.length > 3 && slugLogo.includes(slugProg))
                );
              });
              if (found) {
                detectedProg = found;
              } else if (detectedProg === "HORA GALEGA") {
                detectedProg = "Hora_Galega.png";
              } else {
                detectedProg = "none";
              }
            }
          }
        }
        
        setUpdateForm({
          title: task.title || video.title || "",
          description: updateDescriptionUrl(task.description || video.description || "", detectedProg),
          tags: video.tags || "",
          isScheduled: !!scheduledUpdate,
          scheduledAt: scheduledUpdate && scheduledUpdate.scheduledAt 
            ? toLocalDateTimeString(scheduledUpdate.scheduledAt) 
            : "",
          playlistId: task.playlistId || (scheduledUpdate && scheduledUpdate.playlistId) || ""
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

  // Analizar el documento (PDF o Word) con Gemini e iniciar mapeo automático
  const handleAnalyzeFile = async (e) => {
    e.preventDefault();
    if (!documentFile) {
      alert("Por favor, sube un documento PDF o Word de referencia.");
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
      let activePrivateVideos = [];
      try {
        const ytRes = await fetch("/api/youtube/videos", { cache: "no-store" });
        if (ytRes.ok) {
          activePrivateVideos = await ytRes.json();
          setPrivateVideos(activePrivateVideos);
        } else {
          console.warn("No se pudieron cargar los videos privados del canal.");
        }
      } catch (ytErr) {
        console.warn("YouTube video fetch failed:", ytErr.message);
      }

      // 2. Analizar el archivo (PDF o Word)
      const formData = new FormData();
      formData.append("file", documentFile);
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
      
      // 3. Crear mapeo inicial usando el emparejamiento inteligente de Gemini
      const mapped = data.videos.map((v, i) => {
        // Mapear usando el ID sugerido por Gemini
        const matchedVideo = activePrivateVideos.find(pv => pv.id === v.matchedVideoId) || null;

        // Detectar si el programa corresponde a algún logo del catálogo (evitando seleccionar Hora Galega por defecto de forma genérica, pero asignándolo si corresponde)
        let matchedLogo = "none";
        if (v.programName) {
          const cleanProg = v.programName.toUpperCase().replace(/_/g, " ").trim();
          if (cleanProg === "HORA GALEGA") {
            matchedLogo = "Hora_Galega.png";
          } else {
            const found = programLogosCatalog.find(logo => {
              const cleanLogoName = logo.replace(/\.[^/.]+$/, "").toUpperCase().replace(/_/g, " ").trim();
              const slugLogo = slugify(cleanLogoName);
              const slugProg = slugify(cleanProg);
              return (
                cleanLogoName === cleanProg ||
                slugLogo === slugProg ||
                (slugLogo.length > 3 && slugProg.includes(slugLogo)) ||
                (slugProg.length > 3 && slugLogo.includes(slugProg))
              );
            });
            if (found) {
              matchedLogo = found;
            }
          }
        }

        // Detectar si el programa corresponde a alguna lista de reproducción
        let matchedPlaylistId = "";
        if (v.programName && playlists.length > 0) {
          const foundPlaylist = findBestPlaylist(playlists, v.programName);
          if (foundPlaylist) {
            matchedPlaylistId = foundPlaylist.id;
          }
        }

        const item = {
          index: v.index,
          title: v.title || "",
          description: v.description || "",
          thumbnailText: v.thumbnailText || "",
          isAutoThumbnailEnabled: true,
          selectedProgramLogo: matchedLogo,
          customBgBase64: null,
          generatedThumbnailBase64: null,
          matchedVideoId: matchedVideo ? matchedVideo.id : "",
          isScheduled: false,
          scheduledAt: "",
          playlistId: matchedPlaylistId || "",
          isSyncing: false,
          isSynced: false,
          syncError: null
        };

        // Generar miniatura inicial en segundo plano (con o sin video mapeado para evitar bloqueos)
        generateSingleAutoThumbnail(
          item.thumbnailText,
          matchedVideo,
          null,
          matchedLogo
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

        return item;
      });

      setParsedVideos(mapped);
      setSelectedYoutubeVideo(null); // Cerrar editor individual

      clearInterval(progressInterval);
      setAnalyzeProgress(100);
      
      // Esperar brevemente para mostrar el 100%
      await new Promise(r => setTimeout(r, 400));

      alert(`¡Documento procesado con éxito! Se han detectado ${data.videos.length} videos. Por favor, revisa el mapeo de cada video antes de sincronizar.`);
    } catch (err) {
      clearInterval(progressInterval);
      alert("Error al procesar el archivo: " + err.message);
    } finally {
      clearInterval(progressInterval);
      setIsAnalyzingFile(false);
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

  // Sincronizar todos los videos mapeados en lote
  const handleSyncAllVideos = async () => {
    const matchedItems = parsedVideos.filter(v => v.matchedVideoId);
    if (matchedItems.length === 0) {
      alert("No hay ningún video mapeado con YouTube para sincronizar.");
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
            scheduledAt: item.isScheduled ? item.scheduledAt : null,
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
          playlistId: updateForm.playlistId || null,
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
              <path d="M12.24 10.285V13.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.859-3.579-7.859-8s3.529-8 7.859-8c2.46 0 4.105 1.025 5.047 1.926l2.427-2.334C18.155 2.502 15.427 1.2 12.24 1.2 6.25 1.2 1.39 6.06 1.39 12s4.86 10.8 10.85 10.8c6.26 0 10.42-4.4 10.42-10.6 0-.715-.077-1.26-.172-1.915H12.24z"/>
            </svg>
            Entrar con Google
          </button>
        </div>
      </div>
    );
  }

  return (
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
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}} />
          <span>Comprobando canal de YouTube...</span>
        </div>
      ) : !channel.connected ? (
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
            Para poder gestionar y automatizar la sincronización de tus vídeos, diseñar portadas personalizadas con inteligencia artificial y programar actualizaciones, es necesario conectar primero tu canal de YouTube.
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
                  alert("Configura las credenciales OAuth primero.");
                  setShowSettings(true);
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
                <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.517 0-9.388.508a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.871.508 9.388.508 9.388.508s7.517 0 9.388-.508a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              Conectar canal de YouTube
            </button>

            {!config.isConfigured && (
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
        {/* Columna Izquierda: Sincronización, PDF Editor e Inline Form */}
          
          {/* Tarjeta de Selección y Carga */}
          <div className={styles.card}>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {/* Bloque 1: Carga de Planilla (PDF o Word) */}
              <div style={{ paddingBottom: "1.5rem", borderBottom: "1px solid var(--border-color, #334155)" }}>
                <h3 style={{ fontSize: "0.95rem", fontWeight: "700", marginBottom: "0.5rem", color: "var(--text-primary)" }}>
                  📁 Cargar Plantilla de Contenidos (PDF o Word)
                </h3>


                {/* Dropzone para PDF/Word */}
                <div className={styles.inputGroup}>
                  <div
                    className={styles.uploadArea}
                    style={{ 
                      padding: "1.5rem", 
                      border: "2px dashed var(--border-color, #334155)", 
                      borderRadius: "8px", 
                      textAlign: "center", 
                      cursor: "pointer", 
                      background: "rgba(255,255,255,0.01)" 
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files[0];
                      if (file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
                        setDocumentFile(file);
                      } else {
                        alert("Por favor, sube un archivo PDF o Word (.docx) válido.");
                      }
                    }}
                    onClick={() => pdfInputRef.current?.click()}
                  >
                    <div style={{ fontSize: "2.2rem", marginBottom: "0.5rem" }}>📄</div>
                    <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: "600" }}>
                      {documentFile 
                        ? `Documento Seleccionado: ${documentFile.name}` 
                        : "Arrastra tu archivo PDF o Word (.docx) aquí o haz clic para explorar"
                      }
                    </p>

                  </div>
                  <input
                    type="file"
                    ref={pdfInputRef}
                    accept="application/pdf, .docx, application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) setDocumentFile(file);
                    }}
                    style={{ display: "none" }}
                  />
                </div>

                {/* Botón de Análisis */}
                <button
                  type="button"
                  onClick={handleAnalyzeFile}
                  disabled={isAnalyzingFile || !documentFile}
                  className={styles.btnSubmit}
                  style={{ 
                    marginTop: "1rem", 
                    background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", 
                    opacity: (isAnalyzingFile || !documentFile) ? 0.6 : 1 
                  }}
                >
                  {isAnalyzingFile ? "Procesando documento con IA..." : "⚡ Procesar Documento en Lote"}
                </button>

                {isAnalyzingFile && (
                  <div style={{ marginTop: "1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.80rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                      <span>Analizando contenido con Gemini...</span>
                      <span>{analyzeProgress}%</span>
                    </div>
                    <div className={styles.batchSyncProgressOuter} style={{ marginTop: 0 }}>
                      <div 
                        className={styles.batchSyncProgressInner} 
                        style={{ 
                          width: `${analyzeProgress}%`,
                          background: "linear-gradient(90deg, #a855f7 0%, #ec4899 100%)",
                          boxShadow: "0 0 10px rgba(168, 85, 247, 0.5)"
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Bloque 2: Buscador Manual por Título */}
              <div>
                <h3 style={{ fontSize: "0.95rem", fontWeight: "700", marginBottom: "0.5rem", color: "var(--text-primary)" }}>
                  🔍 Buscar Vídeos Específicos
                </h3>

                <div className={styles.inputGroup}>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input
                      type="text"
                      placeholder="Escribe palabras clave del título del video..."
                      value={searchTitle}
                      onChange={(e) => setSearchTitle(e.target.value)}
                      style={{ flex: 1 }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          fetchYoutubeVideosByTitle(searchTitle);
                        }
                      }}
                    />
                    <button
                      onClick={() => fetchYoutubeVideosByTitle(searchTitle)}
                      disabled={loadingYoutubeVideo || !searchTitle.trim()}
                      className={styles.btnSubmit}
                      style={{ width: "auto", whiteSpace: "nowrap" }}
                    >
                      {loadingYoutubeVideo ? "Buscando..." : "Buscar Video"}
                    </button>
                  </div>
                </div>

                {/* Resultados de la búsqueda */}
                {searchResults.length > 0 && (
                  <div style={{ 
                    marginTop: "1rem", 
                    background: "var(--bg-card, #0f172a)", 
                    border: "1px solid var(--border-color, #334155)", 
                    borderRadius: "12px", 
                    maxHeight: "250px", 
                    overflowY: "auto", 
                    padding: "0.5rem" 
                  }}>
                    {searchResults.map(video => (
                      <div key={video.id} style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        gap: "0.75rem", 
                        padding: "0.5rem", 
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                        justifyContent: "space-between"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1, minWidth: 0 }}>
                          <img src={video.thumbnail} alt="" style={{ width: "64px", aspectRatio: "16/9", objectFit: "cover", borderRadius: "4px" }} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: "0.8rem", fontWeight: "600", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                              {video.title}
                            </div>
                            <span style={{ 
                              fontSize: "0.7rem", 
                              color: video.privacyStatus === 'private' ? "#ef4444" : "#f59e0b",
                              background: video.privacyStatus === 'private' ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)",
                              padding: "1px 6px",
                              borderRadius: "10px"
                            }}>
                              {video.privacyStatus === 'private' ? "Privado" : "Oculto"}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            handleSelectVideo(video);
                            setSearchResults([]);
                          }}
                          className={styles.btnSubmit}
                          style={{ width: "auto", fontSize: "0.75rem", padding: "0.3rem 0.6rem" }}
                        >
                          Editar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Editor en lote para videos parseados */}
          {parsedVideos.length > 0 && (
            <div className={styles.inlineEditPanel} style={{ display: "block", marginTop: "1.5rem" }}>
              <div className={styles.inlineEditHeader} style={{ borderBottom: "1px solid var(--border-color, #334155)" }}>
                <div>
                  <h3 style={{ fontSize: "1.2rem", fontWeight: "800", background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                    ⚡ Sincronizador
                  </h3>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: "500" }}>
                    Documento: <strong>{documentFile?.name}</strong> | Se detectaron {parsedVideos.length} videos
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("¿Descartar el documento actual y todos los cambios no guardados?")) {
                      setParsedVideos([]);
                      setDocumentFile(null);
                    }
                  }}
                  className={styles.closeBtn}
                  title="Descartar lote"
                >✕</button>
              </div>

              {/* Lista de videos en lote */}
              <div style={{ display: "flex", flexDirection: "column", gap: "2rem", marginTop: "1.5rem" }}>
                {parsedVideos.map((item, idx) => {
                  const matchedVideo = privateVideos.find(pv => pv.id === item.matchedVideoId);
                  
                  return (
                    <div key={item.index} style={{
                      border: "1px solid var(--border-color, #334155)",
                      borderRadius: "16px",
                      padding: "1.5rem",
                      background: "rgba(15, 23, 42, 0.25)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "1.5rem",
                      position: "relative"
                    }}>
                      {/* Estado de sincronización en tarjeta */}
                      {item.isSynced && (
                        <div style={{
                          position: "absolute", top: "1rem", right: "1rem",
                          background: "rgba(16, 185, 129, 0.15)", color: "#10b981",
                          fontSize: "0.75rem", fontWeight: "bold", padding: "4px 10px", borderRadius: "12px",
                          border: "1px solid rgba(16, 185, 129, 0.3)"
                        }}>
                          ✓ Sincronizado
                        </div>
                      )}
                      {item.syncError && (
                        <div style={{
                          position: "absolute", top: "1rem", right: "1rem",
                          background: "rgba(239, 68, 68, 0.15)", color: "#ef4444",
                          fontSize: "0.75rem", fontWeight: "bold", padding: "4px 10px", borderRadius: "12px",
                          border: "1px solid rgba(239, 68, 68, 0.3)"
                        }}>
                          ⚠️ {item.syncError}
                        </div>
                      )}

                      <h4 style={{ fontSize: "1rem", margin: 0, fontWeight: "700", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ background: "linear-gradient(135deg, #a855f7 0%, #6366f1 100%)", color: "#fff", width: "24px", height: "24px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", fontSize: "0.8rem" }}>
                          {item.index}
                        </span>
                        Vídeo {item.index} del documento
                      </h4>

                      <div className={styles.inlineEditContent} style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: "1.5rem" }}>
                        {/* Columna Izquierda: Vinculación y Portada */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignSelf: "start" }}>
                          {/* Selector de Video Privado */}
                          <div className={styles.inputGroup} style={{ margin: 0 }}>
                            <label style={{ fontSize: "0.8rem", fontWeight: "600" }}>Seleccionar vídeo manualmente:</label>
                            <select
                              value={item.matchedVideoId}
                              onChange={(e) => {
                                const newId = e.target.value;
                                regenerateThumbnailForIndex(item.index, { matchedVideoId: newId });
                              }}
                              style={{
                                padding: "0.5rem",
                                background: "var(--bg-surface, #0f172a)",
                                border: "1px solid var(--border-color, #334155)",
                                borderRadius: "6px",
                                color: "#fff",
                                fontSize: "0.8rem",
                                width: "100%",
                                marginTop: "0.25rem"
                              }}
                            >
                              <option value="">--Vincula un video específico--</option>
                              {privateVideos.map(pv => (
                                <option key={pv.id} value={pv.id}>
                                  {pv.title} ({pv.privacyStatus === 'private' ? 'Privado' : 'Oculto'})
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Previsualización del vídeo actual mapeado */}
                          {matchedVideo && (
                            <div style={{ display: "flex", gap: "0.5rem", background: "rgba(255,255,255,0.02)", padding: "0.5rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                              <img src={matchedVideo.thumbnail} alt="" style={{ width: "80px", aspectRatio: "16/9", objectFit: "cover", borderRadius: "4px" }} />
                              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
                                <span style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {matchedVideo.title}
                                </span>
                                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>ID: {matchedVideo.id}</span>
                              </div>
                            </div>
                          )}

                          {/* Miniatura automática */}
                          <div style={{
                            border: "1px solid var(--border-color, #334155)",
                            borderRadius: "12px",
                            padding: "0.75rem",
                            background: "rgba(255,255,255,0.01)"
                          }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                              <span style={{ fontWeight: "600", fontSize: "0.8rem" }}>
                                🎨 Portada automática estilo TVG
                              </span>
                              <label className={styles.switch} style={{ position: "relative", display: "inline-block", width: "40px", height: "20px" }}>
                                <input
                                  type="checkbox"
                                  checked={item.isAutoThumbnailEnabled}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    regenerateThumbnailForIndex(item.index, { isAutoThumbnailEnabled: val });
                                  }}
                                  style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span style={{
                                  position: "absolute", cursor: "pointer",
                                  top: 0, left: 0, right: 0, bottom: 0,
                                  backgroundColor: item.isAutoThumbnailEnabled ? "#10b981" : "#4b5563",
                                  transition: "0.2s", borderRadius: "20px"
                                }}>
                                  <span style={{
                                    position: "absolute", content: "''",
                                    height: "14px", width: "14px",
                                    left: item.isAutoThumbnailEnabled ? "22px" : "4px", bottom: "3px",
                                    backgroundColor: "white", transition: "0.2s", borderRadius: "50%"
                                  }} />
                                </span>
                              </label>
                            </div>

                            {item.isAutoThumbnailEnabled ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                <div style={{ position: "relative", width: "100%", maxWidth: "320px", aspectRatio: "16/9", borderRadius: "6px", overflow: "hidden", border: "1px solid var(--border-color, #334155)", background: "#000" }}>
                                  {item.generatedThumbnailBase64 ? (
                                    <img src={item.generatedThumbnailBase64} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                  ) : (
                                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "0.75rem" }}>
                                      Generando miniatura...
                                    </div>
                                  )}
                                </div>

                                {/* Frase SEO Gallego */}
                                <div className={styles.inputGroup} style={{ margin: 0 }}>
                                  <label style={{ fontSize: "0.7rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span>Texto SEO Gallego (4 palabras)</span>
                                    <button
                                      type="button"
                                      disabled={generatingSeoIndex[item.index]}
                                      onClick={() => handleGenerateSeoPhraseForIndex(item.index, item.title, item.description)}
                                      className={styles.btnSubmit}
                                      style={{
                                        width: "auto",
                                        fontSize: "0.65rem",
                                        padding: "1px 6px",
                                        margin: 0,
                                        background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                                        border: "none",
                                        borderRadius: "4px",
                                        color: "#fff",
                                        opacity: generatingSeoIndex[item.index] ? 0.6 : 1,
                                        cursor: generatingSeoIndex[item.index] ? "not-allowed" : "pointer"
                                      }}
                                    >
                                      {generatingSeoIndex[item.index] ? "Generando..." : "🪄 Generar con IA"}
                                    </button>
                                  </label>
                                  <input
                                    type="text"
                                    value={item.thumbnailText}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      regenerateThumbnailForIndex(item.index, { thumbnailText: val });
                                    }}
                                    placeholder="Ej: GRAN CONCURSO HORA GALEGA"
                                    style={{ padding: "0.3rem", fontSize: "0.8rem" }}
                                  />
                                  {generatingSeoIndex[item.index] && (
                                    <div style={{
                                      marginTop: "0.2rem",
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

                                {/* Fondo Personalizado */}
                                <div className={styles.inputGroup} style={{ margin: 0 }}>
                                  <label style={{ fontSize: "0.7rem", display: "flex", justifyContent: "space-between" }}>
                                    <span>Fondo Personalizado</span>
                                    {item.customBgBase64 && (
                                      <button type="button" onClick={() => regenerateThumbnailForIndex(item.index, { customBgBase64: null })} style={{ background: "none", border: "none", color: "#ef4444", fontSize: "0.75rem", cursor: "pointer", padding: 0 }}>Restaurar</button>
                                    )}
                                  </label>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => {
                                      const file = e.target.files[0];
                                      if (file) {
                                        const reader = new FileReader();
                                        reader.onload = (ev) => {
                                          regenerateThumbnailForIndex(item.index, { customBgBase64: ev.target.result });
                                        };
                                        reader.readAsDataURL(file);
                                      }
                                    }}
                                    style={{ fontSize: "0.75rem" }}
                                  />
                                </div>

                                {/* Logotipo del programa */}
                                <div className={styles.inputGroup} style={{ margin: 0 }}>
                                  <label style={{ fontSize: "0.7rem" }}>Logotipo del programa</label>
                                  <select
                                    value={item.selectedProgramLogo || "none"}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      handleBatchLogoChange(item.index, val);
                                    }}
                                    style={{
                                      padding: "0.3rem",
                                      background: "var(--bg-surface, #0f172a)",
                                      border: "1px solid var(--border-color, #334155)",
                                      borderRadius: "4px",
                                      color: "#fff",
                                      fontSize: "0.75rem"
                                    }}
                                  >
                                    <option value="none">Ninguno (Sin logo)</option>
                                    {programLogosCatalog.map(logo => (
                                      <option key={logo} value={logo}>
                                        {logo.replace(/\.[^/.]+$/, "").replace(/_/g, " ")}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Imagen convencional de portada:</label>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => {
                                    const file = e.target.files[0];
                                    if (file) {
                                      const reader = new FileReader();
                                      reader.onload = (ev) => {
                                        regenerateThumbnailForIndex(item.index, { generatedThumbnailBase64: ev.target.result });
                                      };
                                      reader.readAsDataURL(file);
                                    }
                                  }}
                                  style={{ fontSize: "0.75rem" }}
                                />
                                {item.generatedThumbnailBase64 && (
                                  <div style={{ marginTop: "0.5rem", position: "relative", width: "120px" }}>
                                    <img src={item.generatedThumbnailBase64} alt="Thumb" style={{ width: "100%", borderRadius: "4px" }} />
                                    <button type="button" onClick={() => regenerateThumbnailForIndex(item.index, { generatedThumbnailBase64: null })} style={{ position: "absolute", top: "-5px", right: "-5px", background: "#ef4444", color: "#fff", border: "none", borderRadius: "50%", cursor: "pointer", width: "18px", height: "18px", fontSize: "10px" }}>✕</button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Columna Derecha: Metadatos del Video */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                          <div className={styles.inputGroup} style={{ margin: 0 }}>
                            <label style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>Título en YouTube</span>
                              <span style={{ fontSize: "0.75rem", color: (item.title?.length || 0) >= 90 ? "#ef4444" : "var(--text-muted)" }}>
                                {(item.title?.length || 0)}/100
                              </span>
                            </label>
                            <input
                              type="text"
                              maxLength={100}
                              value={item.title}
                              onChange={(e) => {
                                const val = e.target.value;
                                setParsedVideos(prev => {
                                  const list = [...prev];
                                  const targetIdx = list.findIndex(x => x.index === item.index);
                                  if (targetIdx !== -1) list[targetIdx].title = val;
                                  return list;
                                });
                              }}
                              required
                            />
                          </div>

                          <div className={styles.inputGroup} style={{ margin: 0 }}>
                            <label>Descripción del vídeo</label>
                            <textarea
                              rows="8"
                              value={item.description}
                              onChange={(e) => {
                                const val = e.target.value;
                                setParsedVideos(prev => {
                                  const list = [...prev];
                                  const targetIdx = list.findIndex(x => x.index === item.index);
                                  if (targetIdx !== -1) list[targetIdx].description = val;
                                  return list;
                                });
                              }}
                              required
                              style={{ fontSize: "0.8rem", lineHeight: "1.4" }}
                            />

                          </div>

                          {/* Playlist */}
                          <div className={styles.inputGroup} style={{ margin: 0 }}>
                            <label style={{ fontSize: "0.8rem", fontWeight: "600" }}>Añadir a Lista de Reproducción:</label>
                            <select
                              value={item.playlistId || ""}
                              onChange={(e) => {
                                handleBatchPlaylistChange(item.index, e.target.value);
                              }}
                              style={{
                                padding: "0.5rem",
                                background: "var(--bg-surface, #0f172a)",
                                border: "1px solid var(--border-color, #334155)",
                                borderRadius: "6px",
                                color: "#fff",
                                fontSize: "0.8rem"
                              }}
                            >
                              <option value="">-- Ninguna lista --</option>
                              {playlists.map(pl => (
                                <option key={pl.id} value={pl.id}>{pl.title}</option>
                              ))}
                            </select>
                          </div>

                          {/* Programación */}
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <input
                                type="checkbox"
                                id={`sched-${item.index}`}
                                checked={item.isScheduled}
                                onChange={(e) => {
                                  const val = e.target.checked;
                                  setParsedVideos(prev => {
                                    const list = [...prev];
                                    const targetIdx = list.findIndex(x => x.index === item.index);
                                    if (targetIdx !== -1) list[targetIdx].isScheduled = val;
                                    return list;
                                  });
                                }}
                              />
                              <label htmlFor={`sched-${item.index}`} style={{ cursor: "pointer", fontSize: "0.8rem", fontWeight: "600" }}>
                                Programar sincronización automática:
                              </label>
                            </div>

                            {item.isScheduled && (
                              <div className={styles.inputGroup} style={{ margin: 0 }}>
                                <label style={{ fontSize: "0.75rem" }}>Fecha y Hora</label>
                                <DateTimePicker
                                  required={item.isScheduled}
                                  value={item.scheduledAt}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setParsedVideos(prev => {
                                      const list = [...prev];
                                      const targetIdx = list.findIndex(x => x.index === item.index);
                                      if (targetIdx !== -1) list[targetIdx].scheduledAt = val;
                                      return list;
                                    });
                                  }}
                                  style={{ fontSize: "0.8rem" }}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Botón de Sincronización en Lote */}
              <div style={{
                marginTop: "2rem",
                paddingTop: "1.5rem",
                borderTop: "1px solid var(--border-color, #334155)",
                display: "flex",
                gap: "1rem"
              }}>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("¿Descartar el documento actual y todos los cambios no guardados?")) {
                      setParsedVideos([]);
                      setDocumentFile(null);
                    }
                  }}
                  className={styles.btnCancel}
                  style={{ flex: 1 }}
                >Descartar Todo</button>
                <button
                  type="button"
                  onClick={handleSyncAllVideos}
                  disabled={isSyncingBatch}
                  className={styles.btnSubmit}
                  style={{ flex: 2, background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", boxShadow: "0 4px 15px rgba(16, 185, 129, 0.3)" }}
                >
                  🚀 Sincronizar todos los videos ({parsedVideos.filter(v => v.matchedVideoId).length} mapeados)
                </button>
              </div>
            </div>
          )}

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
                  <strong>Estado actual:</strong> Listo para edición.
                  <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Los datos correspondientes se han cargado en el editor. Realiza tus cambios y sincroniza con YouTube para aplicar.
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
                        <div style={{ position: "relative", width: "100%", maxWidth: "320px", aspectRatio: "16/9", borderRadius: "6px", overflow: "hidden", border: "1px solid var(--border-color)", background: "#000" }}>
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
                                             handleLogoChange(logo);
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
                                               if (res.ok) {
                                                 await fetchProgramLogosCatalog();
                                                 if (selectedProgramLogo === logo) setSelectedProgramLogo("none");
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
                                     ))}
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

                    <canvas ref={canvasRef} style={{ display: "none" }} />
                  </div>

                  {/* Lista de reproducción */}
                  <div className={styles.inputGroup} style={{ marginTop: "1rem" }}>
                    <label htmlFor="playlistSelect" style={{ fontSize: "0.85rem", fontWeight: "600" }}>
                      Añadir a Lista de Reproducción de YouTube:
                    </label>
                    <select
                      id="playlistSelect"
                      value={updateForm.playlistId || ""}
                      onChange={(e) => handleSinglePlaylistChange(e.target.value)}
                      style={{
                        padding: "0.5rem",
                        background: "var(--bg-surface, #0f172a)",
                        border: "1px solid var(--border-color, #334155)",
                        borderRadius: "6px",
                        color: "#fff",
                        width: "100%",
                        fontSize: "0.85rem",
                        marginTop: "0.25rem"
                      }}
                    >
                      <option value="">-- Ninguna lista (No añadir) --</option>
                      {playlists.map((playlist) => (
                        <option key={playlist.id} value={playlist.id}>
                          {playlist.title}
                        </option>
                      ))}
                    </select>
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
                      <DateTimePicker
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
              <div className={styles.cardTitle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Cola de Actualizaciones Programadas Locales</span>
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

        {/* Fila 3: Videos Pendientes e Historial (en dos columnas abajo) */}
        <div className={styles.bottomGrid}>
          
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
    )}

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

            {isAuthRequired && (
              <div style={{
                marginTop: "1.5rem",
                paddingTop: "1.5rem",
                borderTop: "1px solid var(--border-color, #334155)",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem"
              }}>
                <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: "600" }}>
                  Sesión de la Aplicación
                </label>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.75rem 1rem",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid var(--border-color, #334155)",
                  borderRadius: "8px"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "1.2rem" }}>👤</span>
                    <span style={{ fontSize: "0.85rem", color: "#f8fafc", fontWeight: "500" }}>
                      {currentUserEmail}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = "/api/auth/logout";
                    }}
                    className={styles.disconnectBtn}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.25rem",
                      padding: "0.5rem 0.8rem",
                      fontSize: "0.8rem",
                      width: "auto",
                      margin: 0
                    }}
                    title="Cerrar sesión"
                  >
                    🔒 Bloquear / Saír
                  </button>
                </div>
              </div>
            )}

            <div className={styles.settingsActions}>
              <button type="button" onClick={() => setShowSettings(false)} className={styles.btnCancel}>Cancelar</button>
              <button type="submit" disabled={savingConfig} className={styles.btnSubmit} style={{ width: "auto" }}>
                {savingConfig ? "Guardando..." : "Guardar Cambios"}
              </button>
            </div>
          </form>
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
            <div style={{ maxHeight: "250px", overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", padding: "0.25rem" }}>
              {programLogosCatalog.length === 0 ? (
                <div style={{ gridColumn: "span 2", fontSize: "0.8rem", color: "var(--text-muted)", textAlign: "center", padding: "1rem" }}>
                  No hay logotipos registrados en el catálogo.
                </div>
              ) : (
                programLogosCatalog.map(logo => (
                  <div key={logo} style={{
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
                      <img src={`/program_logos/${logo}`} alt="" style={{ width: "32px", height: "32px", objectFit: "contain", borderRadius: "4px", background: "rgba(255,255,255,0.05)" }} />
                      <span style={{ fontSize: "0.75rem", fontWeight: "600", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                        {logo.replace(/\.[^/.]+$/, "").replace(/_/g, " ")}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Eliminar ${logo}`}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#ef4444",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        padding: "0.25rem"
                      }}
                      onClick={async () => {
                        if (!confirm(`¿Eliminar el logotipo "${logo}"?`)) return;
                        try {
                          const res = await fetch("/api/program-logos", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ filename: logo }),
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
                ))
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
    </div>
  );
}
