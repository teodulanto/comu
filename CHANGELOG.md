# Historial de cambios

Los cambios relevantes de Comu se documentan en este archivo.

## 0.3.0 - 2026-08-25

### Incorporado

- Nuevo nombre e identidad Comu.
- Dictado local para Windows mediante `whisper.cpp` y modelos GGML Q5.
- Modos Preciso y Rapido.
- Indicador compacto con nivel de audio, estados y cancelacion.
- Atajo global configurable y dos modos de activacion.
- Configuracion de idioma, microfono y vocabulario personal.
- Bandeja del sistema e inicio automatico con Windows.
- Captura segura de la ventana de destino y respaldo en portapapeles.
- Descarga reanudable de modelos con verificacion SHA-256.
- Trabajos locales recuperables cuando falla la transcripcion.
- Instalador y desinstalador NSIS.

### Migracion

- Las instalaciones anteriores se reconocen y se retiran durante la actualizacion.
- Las preferencias, el modelo descargado y la configuracion de inicio se conservan.
