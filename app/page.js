"use client";

import { useState, useEffect } from "react";
import styles from "./page.module.css";
import Navbar from "./components/Navbar";

export default function LandingPortalPage() {
  // Estados de autenticación de la aplicación (Google Sign-In)
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState("ADMIN");
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authError, setAuthError] = useState("");

  // Estado del canal
  const [channel, setChannel] = useState({ connected: false, channel: null });
  const [loadingChannel, setLoadingChannel] = useState(true);

  // Estados de gestión de usuarios (solo ADMIN)
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("PRODUCTORA");
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [inviting, setInviting] = useState(false);

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
              const userRole = data.user.role || "ADMIN";
              setCurrentUserRole(userRole);

              // Redirigir según el rol del usuario si es necesario
              if (userRole === "PRODUCTORA") {
                window.location.href = "/subidor";
                return;
              } else if (userRole === "SEO_MANAGER") {
                window.location.href = "/editor";
                return;
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

  // Obtener estado del canal de YouTube
  const fetchChannelStatus = async () => {
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

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.error("Error al obtener la configuración:", err);
    }
  };

  const fetchUsers = async () => {
    if (currentUserRole !== "ADMIN") return;
    setLoadingUsers(true);
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error("Error fetching users:", err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleInviteUser = async (e) => {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    if (!newEmail.trim()) {
      setInviteError("El correo electrónico es requerido.");
      return;
    }
    setInviting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al invitar al usuario.");
      }
      if (data.emailSent) {
        setInviteSuccess(`Usuario ${newEmail} invitado y correo de aviso enviado con éxito.`);
      } else {
        setInviteSuccess(`Usuario ${newEmail} invitado con éxito, pero falló el envío del correo: ${data.emailError || "error desconocido (verifica configuración SMTP)"}`);
      }
      setNewEmail("");
      fetchUsers();
    } catch (err) {
      setInviteError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeUser = async (email) => {
    if (!window.confirm(`¿Estás seguro de que deseas revocar el acceso a ${email}?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/users?email=${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al revocar el acceso.");
      }
      alert("Acceso revocado correctamente.");
      fetchUsers();
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchConfig();
      fetchChannelStatus();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && currentUserRole === "ADMIN") {
      fetchUsers();
    }
  }, [isAuthenticated, currentUserRole]);

  const handleGoogleLogin = () => {
    window.location.href = "/api/auth/app-login";
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

      if (!res.ok) throw new Error("Error al guardar.");

      alert("Configuración guardada correctamente.");
      setShowSettings(false);
      setConfigInput({ GEMINI_API_KEY: "", YOUTUBE_CLIENT_ID: "", YOUTUBE_CLIENT_SECRET: "" });
      await fetchConfig();
      await fetchChannelStatus();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setSavingConfig(false);
    }
  };

  const disconnectChannel = async () => {
    if (window.confirm("¿Estás seguro de que deseas desconectar el canal de YouTube?")) {
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
            Inicia sesión para poder acceder a los paneles de trabajo.
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
      <div className={styles.container} style={{ maxWidth: "900px", padding: "2rem 1rem" }}>
        
        {/* Encabezado */}
        <header style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "3rem",
          borderBottom: "1px solid var(--border-color)",
          paddingBottom: "1.5rem"
        }}>
          <div>
            <h1 style={{
              fontSize: "2rem",
              fontWeight: "900",
              background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              margin: 0
            }}>
              AutomYouTube
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "0.25rem" }}>
              Portal de Trabajo Independiente para Subidores y Editores
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={() => setShowSettings(true)}
              className={styles.btnSettingsToggle}
              title="Ajustes de Configuración"
            >
              ⚙️
            </button>
          </div>
        </header>

        {/* Canales y advertencias */}
        {!loadingChannel && !channel.connected && (
          <div style={{
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            borderRadius: "12px",
            padding: "1rem",
            marginBottom: "2rem",
            fontSize: "0.85rem",
            color: "#f87171",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}>
            <div>
              <strong>⚠️ Canal de YouTube Desconectado:</strong> Conéctalo en Ajustes ⚙️ para permitir las publicaciones y sincronizaciones automáticas.
            </div>
            <button
              onClick={() => setShowSettings(true)}
              style={{
                background: "rgba(239,68,68,0.2)",
                border: "none",
                borderRadius: "6px",
                padding: "0.3rem 0.6rem",
                color: "#f87171",
                fontSize: "0.75rem",
                cursor: "pointer",
                fontWeight: "bold"
              }}
            >
              Configurar
            </button>
          </div>
        )}

        {/* Panel de Selección de Roles */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "2rem",
          marginBottom: "3rem"
        }}>
          {/* Card Subidor */}
          <div style={{
            background: "rgba(30, 41, 59, 0.4)",
            border: "1px solid var(--border-color)",
            borderRadius: "20px",
            padding: "2.5rem 2rem",
            textAlign: "center",
            backdropFilter: "blur(10px)",
            transition: "all 0.3s ease",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#a855f7";
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = "0 10px 30px rgba(168, 85, 247, 0.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border-color)";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "none";
          }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                width: "70px",
                height: "70px",
                borderRadius: "50%",
                background: "rgba(168, 85, 247, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "2.5rem",
                marginBottom: "1.5rem"
              }}>
                📤
              </div>
              <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#f8fafc", margin: "0 0 1rem 0" }}>
                Flujo Subidor
              </h2>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", lineHeight: "1.6", marginBottom: "2rem" }}>
                Accede a la interfaz simplificada para subir archivos de vídeo locales directamente al servidor y optimizar sus títulos y descripciones preliminares con ayuda de la IA.
              </p>
            </div>
            <a
              href="/subidor"
              style={{
                width: "100%",
                padding: "0.8rem 1.5rem",
                background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                border: "none",
                borderRadius: "12px",
                color: "#fff",
                fontWeight: "700",
                fontSize: "0.9rem",
                textDecoration: "none",
                textAlign: "center",
                display: "block",
                boxShadow: "0 4px 14px rgba(168, 85, 247, 0.2)"
              }}
            >
              Ingresar como Subidor
            </a>
          </div>

          {/* Card Editor */}
          <div style={{
            background: "rgba(30, 41, 59, 0.4)",
            border: "1px solid var(--border-color)",
            borderRadius: "20px",
            padding: "2.5rem 2rem",
            textAlign: "center",
            backdropFilter: "blur(10px)",
            transition: "all 0.3s ease",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#0ea5e9";
            e.currentTarget.style.transform = "translateY(-4px)";
            e.currentTarget.style.boxShadow = "0 10px 30px rgba(14, 165, 233, 0.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border-color)";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "none";
          }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                width: "70px",
                height: "70px",
                borderRadius: "50%",
                background: "rgba(14, 165, 233, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "2.5rem",
                marginBottom: "1.5rem"
              }}>
                🎬
              </div>
              <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#f8fafc", margin: "0 0 1rem 0" }}>
                Flujo Editor
              </h2>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", lineHeight: "1.6", marginBottom: "2rem" }}>
                Accede al panel avanzado de edición. Compón miniaturas estilo TVG con captura automática de fotogramas, procesa documentos PDF en lote, asigna logotipos del catálogo y programa publicaciones en YouTube.
              </p>
            </div>
            <a
              href="/editor"
              style={{
                width: "100%",
                padding: "0.8rem 1.5rem",
                background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)",
                border: "none",
                borderRadius: "12px",
                color: "#fff",
                fontWeight: "700",
                fontSize: "0.9rem",
                textDecoration: "none",
                textAlign: "center",
                display: "block",
                boxShadow: "0 4px 14px rgba(14, 165, 233, 0.2)"
              }}
            >
              Ingresar como Editor
            </a>
          </div>
        </div>

        {/* Panel de Gestión de Usuarios (Sólo Administradores) */}
        {currentUserRole === "ADMIN" && (
          <div style={{
            background: "rgba(30, 41, 59, 0.25)",
            border: "1px solid var(--border-color)",
            borderRadius: "24px",
            padding: "2.5rem 2rem",
            marginTop: "3rem",
            marginBottom: "3rem",
            backdropFilter: "blur(12px)",
            boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.2)"
          }}>
            <h2 style={{
              fontSize: "1.5rem",
              fontWeight: "800",
              color: "#f8fafc",
              marginBottom: "1.5rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem"
            }}>
              👥 Gestión de Acceso y Roles
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "2rem" }}>
              Como administrador, puedes dar permiso a otros correos de Google para acceder a la aplicación y asignarles un rol específico (Productora o Gestor SEO).
            </p>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "2rem"
            }}>
              {/* Formulario de Invitación */}
              <div style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                borderRadius: "16px",
                padding: "1.5rem"
              }}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: "700", marginBottom: "1.25rem", color: "#f8fafc" }}>
                  Invitar Colaborador
                </h3>
                <form onSubmit={handleInviteUser} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                    <label>Correo Electrónico</label>
                    <input
                      type="email"
                      placeholder="ejemplo@gmail.com"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      required
                      style={{ background: "rgba(0, 0, 0, 0.3)" }}
                    />
                  </div>
                  <div className={styles.inputGroup} style={{ marginBottom: 0 }}>
                    <label>Rol Asignado</label>
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value)}
                      style={{ background: "rgba(0, 0, 0, 0.3)", color: "#fff" }}
                    >
                      <option value="PRODUCTORA">Productora 📤 (Solo Subir)</option>
                      <option value="SEO_MANAGER">Gestor SEO 🔍 (Solo Editar/SEO)</option>
                      <option value="ADMIN">Administrador 👑 (Acceso Total)</option>
                    </select>
                  </div>
                  {inviteError && (
                    <div style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                      ⚠️ {inviteError}
                    </div>
                  )}
                  {inviteSuccess && (
                    <div style={{ color: "#10b981", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                      ✅ {inviteSuccess}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={inviting}
                    className={styles.btnSubmit}
                    style={{
                      background: inviting ? "#4b5563" : "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                      cursor: inviting ? "not-allowed" : "pointer",
                      padding: "0.7rem 1.2rem",
                      fontSize: "0.9rem",
                      marginTop: "0.5rem"
                    }}
                  >
                    {inviting ? "Invitando..." : "Otorgar Permiso"}
                  </button>
                </form>
              </div>

              {/* Lista de Usuarios */}
              <div style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                borderRadius: "16px",
                padding: "1.5rem",
                display: "flex",
                flexDirection: "column"
              }}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: "700", marginBottom: "1.25rem", color: "#f8fafc" }}>
                  Colaboradores Registrados
                </h3>
                {loadingUsers ? (
                  <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "2rem" }}>
                    Cargando usuarios...
                  </div>
                ) : users.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "2rem" }}>
                    No hay colaboradores registrados todavía.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "300px", overflowY: "auto", paddingRight: "0.25rem" }}>
                    {users.map((u) => {
                      let roleLabel = u.role;
                      let roleColor = "#94a3b8";
                      let roleBg = "rgba(148, 163, 184, 0.1)";
                      if (u.role === "ADMIN") {
                        roleLabel = "ADMIN";
                        roleColor = "#f97316";
                        roleBg = "rgba(249, 115, 22, 0.12)";
                      } else if (u.role === "PRODUCTORA") {
                        roleLabel = "PRODUCTORA";
                        roleColor = "#a855f7";
                        roleBg = "rgba(168, 85, 247, 0.12)";
                      } else if (u.role === "SEO_MANAGER") {
                        roleLabel = "SEO";
                        roleColor = "#0ea5e9";
                        roleBg = "rgba(14, 165, 233, 0.12)";
                      }
                      const isSelf = u.email.toLowerCase() === currentUserEmail.toLowerCase();

                      return (
                        <div
                          key={u.id || u.email}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "0.75rem",
                            background: "rgba(255, 255, 255, 0.01)",
                            border: "1px solid rgba(255, 255, 255, 0.05)",
                            borderRadius: "10px",
                            gap: "0.5rem"
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                            <span style={{ fontSize: "0.85rem", fontWeight: "600", color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {u.email}
                            </span>
                            {u.invitedBy && (
                              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                                Inv: {u.invitedBy}
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{
                              fontSize: "0.7rem",
                              fontWeight: "700",
                              color: roleColor,
                              backgroundColor: roleBg,
                              padding: "2px 6px",
                              borderRadius: "8px"
                            }}>
                              {roleLabel}
                            </span>
                            {!isSelf && (
                              <button
                                onClick={() => handleRevokeUser(u.email)}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                  fontSize: "0.95rem",
                                  color: "#ef4444",
                                  padding: "0.2rem",
                                  borderRadius: "6px",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  transition: "0.2s"
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)"}
                                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                title="Revocar Acceso"
                              >
                                🗑️
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer/Info del Trabajador */}
        {currentUserEmail && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: "1rem", fontSize: "0.75rem", color: "var(--text-muted)", gap: "0.5rem" }}>
            <span>Sesión activa:</span>
            <strong style={{ color: "var(--text-secondary)" }}>{currentUserEmail}</strong>
            {channel.connected && (
              <>
                <span>| Canal:</span>
                <strong style={{ color: "#10b981" }}>{channel.channel?.title || "Conectado"}</strong>
              </>
            )}
          </div>
        )}

        {/* Panel Ajustes (Drawer lateral/Modal) */}
        {showSettings && (
          <div className={styles.settingsOverlay} onClick={() => setShowSettings(false)}>
            <div className={styles.settingsModal} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h3 style={{ fontSize: "1.2rem", fontWeight: "850" }}>⚙️ Ajustes del Sistema</h3>
                <button className={styles.closeBtn} onClick={() => setShowSettings(false)}>✕</button>
              </div>

              {/* Estado del Canal de YouTube */}
              <div style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid var(--border-color)",
                borderRadius: "12px",
                padding: "1rem",
                marginBottom: "1.5rem"
              }}>
                <h4 style={{ fontSize: "0.9rem", margin: "0 0 0.75rem 0", fontWeight: "700" }}>Conexión con YouTube</h4>
                {loadingChannel ? (
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Consultando estado...</div>
                ) : channel.connected ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      {channel.channel?.thumbnail && (
                        <img src={channel.channel.thumbnail} alt="Canal" style={{ width: "36px", height: "36px", borderRadius: "50%" }} />
                      )}
                      <div>
                        <div style={{ fontSize: "0.85rem", fontWeight: "600", color: "#f8fafc" }}>{channel.channel?.title}</div>
                        <div style={{ fontSize: "0.7rem", color: "#10b981" }}>● Conectado correctamente</div>
                      </div>
                    </div>
                    <button
                      onClick={disconnectChannel}
                      style={{
                        padding: "0.4rem 0.8rem",
                        background: "rgba(239, 68, 68, 0.1)",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        borderRadius: "8px",
                        color: "#ef4444",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                        fontWeight: "600",
                        alignSelf: "flex-start",
                        transition: "0.2s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(239,68,68,0.18)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "rgba(239,68,68,0.1)"}
                    >
                      Desconectar Canal
                    </button>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 0.75rem 0" }}>
                      Para que el publicador pueda editar y subir videos directamente, debes autorizar el canal de YouTube.
                    </p>
                    <a
                      href="/api/auth"
                      style={{
                        display: "inline-block",
                        padding: "0.5rem 1rem",
                        background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                        borderRadius: "8px",
                        color: "#fff",
                        fontSize: "0.8rem",
                        fontWeight: "600",
                        textDecoration: "none",
                        boxShadow: "0 2px 8px rgba(168, 85, 247, 0.2)"
                      }}
                    >
                      🔗 Vincular Canal de YouTube
                    </a>
                  </div>
                )}
              </div>

              {/* Formulario de Credenciales API */}
              <form onSubmit={handleSaveConfig} style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
                <div style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "12px",
                  padding: "1rem"
                }}>
                  <h4 style={{ fontSize: "0.9rem", margin: "0 0 0.75rem 0", fontWeight: "700" }}>Credenciales del Servidor</h4>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 1rem 0" }}>
                    Introduce los tokens para habilitar los modelos de IA de Gemini y las llamadas de API de Google Cloud.
                  </p>

                  <div className={styles.inputGroup}>
                    <label>Gemini API Key</label>
                    <input
                      type="password"
                      placeholder={config.isConfigured ? "••••••••••••••••" : "Introduce tu clave de API de Gemini..."}
                      value={configInput.GEMINI_API_KEY}
                      onChange={(e) => setConfigInput(prev => ({ ...prev, GEMINI_API_KEY: e.target.value }))}
                    />
                  </div>

                  <div className={styles.inputGroup}>
                    <label>YouTube Client ID</label>
                    <input
                      type="text"
                      placeholder={config.isConfigured ? "••••••••••••••••" : "Introduce el Client ID de Google OAuth..."}
                      value={configInput.YOUTUBE_CLIENT_ID}
                      onChange={(e) => setConfigInput(prev => ({ ...prev, YOUTUBE_CLIENT_ID: e.target.value }))}
                    />
                  </div>

                  <div className={styles.inputGroup}>
                    <label>YouTube Client Secret</label>
                    <input
                      type="password"
                      placeholder={config.isConfigured ? "••••••••••••••••" : "Introduce el Client Secret..."}
                      value={configInput.YOUTUBE_CLIENT_SECRET}
                      onChange={(e) => setConfigInput(prev => ({ ...prev, YOUTUBE_CLIENT_SECRET: e.target.value }))}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingConfig}
                  className={styles.btnSubmit}
                  style={{
                    background: savingConfig ? "#4b5563" : "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                    cursor: savingConfig ? "not-allowed" : "pointer"
                  }}
                >
                  {savingConfig ? "Guardando..." : "Guardar Ajustes"}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
