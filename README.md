# Comu

Dictado de voz local, open source y orientado a Windows.

Comu permanece en segundo plano y convierte la voz en texto con un atajo global. La transcripcion se ejecuta en el equipo mediante `whisper.cpp`: no requiere una cuenta, una suscripcion ni una API de pago.

> Estado: primera version publica para Windows. El proyecto funciona y puede instalarse, pero sigue en desarrollo. Las compilaciones actuales no estan firmadas digitalmente.

## Para quien es

Comu esta pensado para personas que escriben con frecuencia y prefieren dictar sin enviar sus grabaciones a un servicio remoto:

- estudiantes, docentes e investigadores;
- profesionales que redactan correos, informes o documentacion;
- creadores y personas que toman notas extensas;
- usuarios que buscan una alternativa local a productos de dictado por suscripcion;
- desarrolladores interesados en mejorar una herramienta de voz abierta para Windows.

No pretende sustituir software medico, forense ni de accesibilidad certificado. La precision depende del microfono, el ruido, el acento, el modelo y el vocabulario utilizado.

## Como funciona

1. Comu se inicia con Windows y queda disponible en la bandeja del sistema.
2. El usuario coloca el cursor en la aplicacion donde quiere escribir.
3. El atajo global inicia la grabacion; de forma predeterminada es `Ctrl + Alt + Espacio`.
4. Una segunda pulsacion detiene la grabacion y comienza la transcripcion local.
5. Si la ventana original sigue activa, Comu pega el texto automaticamente.
6. Si el usuario cambio de ventana, el texto queda en el portapapeles y aparece `Texto listo · Ctrl+V`.

El indicador compacto muestra el nivel del microfono, el tiempo y el estado de procesamiento. Su boton `X` permite cancelar una grabacion u ocultar el indicador sin cerrar el proceso. Para cerrar Comu completamente se usa **Salir** desde la bandeja.

## Funciones actuales

- Transcripcion local con `whisper.cpp` 1.9.3 y OpenBLAS.
- Perfiles **Preciso** (`Whisper small Q5`, 190 MB) y **Rapido** (`Whisper base Q5`, 60 MB).
- Espanol e ingles.
- Atajo global configurable.
- Modos pulsar para iniciar/detener o mantener presionado.
- Seleccion y comprobacion de microfono.
- Diccionario personal para corregir terminos frecuentes.
- Indicador pequeno, movible y sin ocupar la barra de tareas.
- Inicio automatico configurable con Windows.
- Proceso residente en la bandeja del sistema.
- Descarga reanudable del modelo y verificacion SHA-256.
- Portapapeles como respaldo para no perder una transcripcion.
- Trabajos locales recuperables cuando el motor devuelve un error.
- Instalador y desinstalador NSIS para Windows.

## Privacidad

El audio y la inferencia permanecen en el equipo. Comu no incluye cuentas, telemetria ni un servidor de transcripcion.

Se necesita internet para descargar el modelo seleccionado la primera vez, instalar dependencias al compilar desde el codigo y preparar el runtime de `whisper.cpp` para desarrollo.

Cuando una transcripcion termina correctamente, el WAV temporal se elimina. Si ocurre un error recuperable, el audio y los metadatos del trabajo se conservan en la carpeta de datos de la aplicacion para evitar perder el dictado.

## Requisitos de uso

- Windows 10 u 11 de 64 bits.
- WebView2 Runtime, incluido normalmente en Windows moderno.
- Microfono reconocido por Windows.
- Aproximadamente 1 GB de RAM disponible para el perfil Preciso.
- Conexion a internet durante la primera descarga del modelo.

La implementacion actual usa CPU. No requiere una GPU dedicada.

## Instalar

Los instaladores se publicaran en la seccion **Releases** del repositorio. Descarga `Comu_<version>_x64-setup.exe`, ejecutalo y deja que Comu prepare el modelo la primera vez.

Para desinstalar, abre **Configuracion > Aplicaciones > Aplicaciones instaladas**, busca **Comu** y selecciona **Desinstalar**.

## Configuracion para desarrollo

### Requisitos

- Node.js 20 o posterior.
- Rust estable y Cargo.
- Visual Studio Build Tools con **Desktop development with C++**.
- PowerShell 5.1 o posterior.
- WebView2 Runtime.

### Preparar el proyecto

```powershell
git clone https://github.com/teodulanto/comu.git
cd comu
npm install
npm run prepare:whisper
```

`prepare:whisper` descarga el runtime oficial de `whisper.cpp`, valida su SHA-256 y lo coloca en `apps/desktop/src-tauri/resources/whisper`. Los binarios no se guardan en Git.

### Ejecutar la aplicacion

```powershell
npm run tauri:dev
```

La vista web aislada puede abrirse con `npm run dev`, pero el atajo global, la bandeja, el autoinicio, `whisper.cpp` y la insercion de texto requieren Tauri.

### Crear el instalador

```powershell
npm run tauri:build -- --bundles nsis
```

El instalador queda bajo `target/release/bundle/nsis` o en el directorio indicado por `CARGO_TARGET_DIR`.

## Arquitectura

```text
Atajo global (Rust)
  -> ventana React oculta inicia MediaRecorder
  -> AudioContext convierte a PCM mono de 16 kHz
  -> Tauri guarda un trabajo WAV local
  -> whisper.cpp procesa con small Q5 o base Q5
  -> limpieza y diccionario personal
  -> portapapeles
  -> pegado en la ventana original o aviso Ctrl+V
```

### Componentes principales

| Componente | Tecnologia | Responsabilidad |
| --- | --- | --- |
| Interfaz | React 19 + TypeScript + Vite | Configuracion e indicador compacto |
| Escritorio | Tauri 2 | Ventanas, bandeja, instalador y comunicacion nativa |
| Nucleo | Rust | Atajo, autoinicio, foco, portapapeles y trabajos locales |
| Audio | MediaRecorder + Web Audio API | Captura, nivel y conversion a 16 kHz mono |
| Voz a texto | whisper.cpp + OpenBLAS | Inferencia local en CPU |
| Modelos | GGML Q5 | Equilibrio entre precision, velocidad y tamano |
| VAD | Silero VAD | Segmentacion conservadora en el perfil rapido |

Los modelos se descargan bajo demanda. El repositorio contiene codigo, scripts, manifiestos y hashes; no contiene modelos, audios privados, DLL ni resultados de compilacion.

## Limitaciones conocidas

- Solo Windows esta soportado y probado actualmente.
- La transcripcion comienza despues de detener la grabacion; los audios largos pueden tardar varios segundos.
- La puntuacion de textos extensos depende de la prosodia y de las capacidades de Whisper.
- El pegado automatico no funciona en aplicaciones elevadas si Comu no tiene el mismo nivel de permisos.
- Si se cambia de ventana durante el dictado, se prioriza no escribir en el lugar equivocado: el resultado queda en el portapapeles.
- Los instaladores comunitarios actuales pueden activar SmartScreen porque no estan firmados.

## Mejoras prioritarias

- Transcripcion incremental para reducir la espera final en dictados largos.
- Mejor reconstruccion de puntuacion y parrafos sin alterar el significado.
- Historial visible y recuperacion de trabajos desde la interfaz.
- Pruebas automatizadas del flujo nativo de Windows.
- Builds reproducibles y releases firmadas.
- Accesibilidad y localizacion completa de la interfaz.
- Evaluacion de aceleracion opcional por GPU sin convertirla en requisito.

Los benchmarks y decisiones tecnicas estan documentados en [`docs/`](docs/). Los audios de evaluacion permanecen fuera del repositorio por privacidad.

## Colaborar

Las contribuciones son bienvenidas. Antes de abrir un pull request, revisa [CONTRIBUTING.md](CONTRIBUTING.md). Para cambios grandes, abre primero un issue describiendo el problema, la propuesta y como se validara.

## Seguridad y licencias

- Politica de seguridad: [SECURITY.md](SECURITY.md)
- Dependencias y licencias de terceros: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- Licencia del proyecto: [MIT](LICENSE)

Comu no distribuye los modelos como parte del repositorio. Whisper, `whisper.cpp`, OpenBLAS y Silero mantienen sus propias licencias y derechos de autor.
