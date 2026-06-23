import nodemailer from 'nodemailer';
import { getConfig } from './config';

/**
 * Sends an email notification to a user assigned to a role.
 * @param {string} email Target user email
 * @param {string} role User role ('ADMIN', 'PRODUCTORA', 'SEO_MANAGER')
 * @param {string} invitedBy The email of the admin who assigned the role
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendInviteEmail(email, role, invitedBy) {
  // Read SMTP settings
  const host = await getConfig('SMTP_HOST') || process.env.SMTP_HOST;
  const port = await getConfig('SMTP_PORT') || process.env.SMTP_PORT;
  const user = await getConfig('SMTP_USER') || process.env.SMTP_USER;
  const pass = await getConfig('SMTP_PASS') || process.env.SMTP_PASS;
  const from = await getConfig('SMTP_FROM') || process.env.SMTP_FROM || '"YouTube Automation" <noreply@yourdomain.com>';
  const appUrl = 'https://automyoutube.vercel.app';

  if (!host || !port || !user || !pass) {
    console.warn('[Email Service] SMTP configuration is missing. Invite email not sent to:', email);
    return { success: false, error: 'SMTP configuration is missing' };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: parseInt(port, 10) === 465, // true for 465, false for other ports
    auth: {
      user,
      pass,
    },
  });

  const roleNames = {
    'ADMIN': 'Administrador 👑',
    'PRODUCTORA': 'Productora 📤 (Subidor de Vídeos)',
    'SEO_MANAGER': 'Gestor SEO 🔍 (Editor SEO)'
  };

  const roleName = roleNames[role] || role;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Invitación a AutomYouTube</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: #060814;
            color: #f8fafc;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 40px auto;
            background: #0f172a;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 24px;
            padding: 40px;
            box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
          }
          .logo {
            font-size: 24px;
            font-weight: 900;
            color: #d946ef;
            display: inline-block;
          }
          .title {
            font-size: 22px;
            font-weight: 800;
            color: #ffffff;
            margin-top: 10px;
            text-align: center;
          }
          .text {
            font-size: 16px;
            line-height: 1.6;
            color: #94a3b8;
            margin-bottom: 25px;
          }
          .role-box {
            background: rgba(168, 85, 247, 0.1);
            border: 1px solid rgba(168, 85, 247, 0.2);
            border-radius: 12px;
            padding: 15px;
            text-align: center;
            font-size: 18px;
            font-weight: 700;
            color: #c084fc;
            margin: 20px 0;
          }
          .btn-container {
            text-align: center;
            margin: 30px 0;
          }
          .btn {
            background: linear-gradient(135deg, #a855f7 0%, #6366f1 100%);
            border: none;
            color: #ffffff !important;
            padding: 14px 28px;
            border-radius: 12px;
            font-weight: 700;
            font-size: 16px;
            text-decoration: none;
            display: inline-block;
            box-shadow: 0 4px 15px rgba(168, 85, 247, 0.3);
          }
          .footer {
            margin-top: 40px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            padding-top: 20px;
            text-align: center;
            font-size: 12px;
            color: #64748b;
          }
        </style>
      </head>
      <body>
        <div class="container" style="background-color: #0f172a; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 24px; padding: 40px; color: #f8fafc;">
          <div class="header" style="text-align: center; margin-bottom: 30px;">
            <span class="logo" style="font-size: 24px; font-weight: 900; color: #d946ef;">AutomYouTube</span>
            <div class="title" style="font-size: 22px; font-weight: 800; color: #ffffff; margin-top: 10px;">¡Has sido invitado a colaborar!</div>
          </div>
          <div class="text" style="font-size: 16px; line-height: 1.6; color: #94a3b8; margin-bottom: 25px;">
            Hola,
          </div>
          <div class="text" style="font-size: 16px; line-height: 1.6; color: #94a3b8; margin-bottom: 25px;">
            Te informamos de que el administrador <strong>${invitedBy}</strong> te ha asignado un rol de acceso en la plataforma <strong>AutomYouTube</strong>.
          </div>
          <div class="role-box" style="background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 12px; padding: 15px; text-align: center; font-size: 18px; font-weight: 700; color: #c084fc; margin: 20px 0;">
            Rol: ${roleName}
          </div>
          <div class="text" style="font-size: 16px; line-height: 1.6; color: #94a3b8; margin-bottom: 25px;">
            A partir de ahora puedes acceder a la aplicación utilizando tu cuenta de Google (<strong>${email}</strong>) haciendo clic en el siguiente enlace:
          </div>
          <div class="btn-container" style="text-align: center; margin: 30px 0;">
            <a href="${appUrl}" class="btn" style="background: linear-gradient(135deg, #a855f7 0%, #6366f1 100%); color: #ffffff !important; padding: 14px 28px; border-radius: 12px; font-weight: 700; font-size: 16px; text-decoration: none; display: inline-block;">Acceder a la Aplicación</a>
          </div>
          <div class="text" style="font-size: 16px; line-height: 1.6; color: #94a3b8; margin-bottom: 25px;">
            Si tienes alguna duda o necesitas ayuda para empezar, por favor contacta con el administrador del sistema.
          </div>
          <div class="footer" style="margin-top: 40px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 20px; text-align: center; font-size: 12px; color: #64748b;">
            Este correo es informativo. No respondas directamente a este mensaje.<br>
            &copy; ${new Date().getFullYear()} AutomYouTube. Todos los derechos reservados.
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    const info = await transporter.sendMail({
      from,
      to: email,
      subject: `Invitación a colaborar en AutomYouTube - Rol: ${role}`,
      html: htmlContent,
    });
    console.log('[Email Service] Invite email sent successfully to:', email, 'MessageId:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[Email Service] Error sending invite email:', error);
    return { success: false, error: error.message };
  }
}
