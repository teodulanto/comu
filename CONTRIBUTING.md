# Contribuir a Comu

Gracias por ayudar a mejorar Comu. El objetivo es mantener una herramienta de dictado local para Windows que sea comprensible, recuperable ante fallos y sencilla de instalar.

## Antes de empezar

1. Busca issues existentes para evitar trabajo duplicado.
2. Para cambios de arquitectura, modelos, privacidad o instalacion, abre primero un issue.
3. Manten cada pull request enfocado en un problema concreto.
4. No incluyas audios personales, modelos, binarios, instaladores ni carpetas `target`.

## Entorno

Necesitas Windows 10/11, Node.js 20+, Rust estable, Visual Studio Build Tools con C++ y WebView2.

```powershell
npm install
npm run prepare:whisper
npm run tauri:dev
```

## Validacion minima

Antes de enviar un pull request:

```powershell
npm run build
cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Para cambios de comportamiento, prueba tambien:

1. Inicio y detencion mediante el atajo global.
2. Cancelacion con la X y liberacion del microfono.
3. Pegado en Notepad cuando la ventana original sigue activa.
4. Respaldo en portapapeles cuando se cambia de ventana.
5. Apertura de Configuracion y cierre completo desde la bandeja.
6. Inicio automatico activado y desactivado.

Describe en el pull request el equipo usado, el modelo seleccionado y los resultados observados.

## Estilo y alcance

- TypeScript para la interfaz y Rust para integraciones nativas.
- Prefiere cambios pequenos y compatibles con los patrones existentes.
- No agregues una API remota, telemetria ni subida de audio sin una discusion publica y consentimiento explicito.
- No cambies `com.dictadolocal.desktop`: es un identificador heredado que permite actualizar instalaciones antiguas sin perder modelos ni preferencias.
- Documenta dependencias nuevas y agrega sus licencias a `THIRD_PARTY_NOTICES.md`.
- Las mejoras de precision deben compararse con un corpus reproducible y metricas, no solo con una muestra favorable.

## Commits y pull requests

Usa mensajes breves en imperativo, por ejemplo:

```text
Reduce la espera al finalizar dictados largos
```

Un pull request debe explicar el problema, el enfoque elegido, los riesgos, los pasos de prueba y las capturas necesarias cuando cambie la interfaz.

## Reportes de errores

Incluye version de Comu, version de Windows, CPU, microfono, perfil de calidad, duracion aproximada y pasos de reproduccion. No adjuntes una grabacion real salvo que hayas eliminado datos sensibles y aceptes publicarla.
