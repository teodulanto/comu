# Nucleo Tauri de Comu

Esta carpeta contiene la integracion nativa para Windows.

## Responsabilidades

- crear el indicador y la ventana de configuracion;
- mantener el icono de bandeja;
- registrar el atajo global;
- configurar el inicio con Windows;
- recordar la ventana de destino;
- copiar y pegar texto de forma segura;
- descargar y verificar modelos GGML;
- guardar trabajos locales;
- ejecutar `whisper.cpp` sin mostrar una consola;
- generar el instalador NSIS.

El frontend React vive en `apps/desktop/src`. Los comandos Tauri estan en `src/lib.rs` y el motor local en `src/transcription.rs`.

## Runtime local

Los archivos de `resources/whisper` no se versionan. Desde la raiz:

```powershell
npm run prepare:whisper
```

El script descarga una version fijada, valida su hash y prepara los binarios necesarios para desarrollo y empaquetado.

## Compatibilidad de actualizaciones

El identificador Tauri conserva un valor heredado para reconocer instalaciones previas. No debe cambiarse sin una migracion explicita de modelos, preferencias, registro de Windows y datos WebView2.
