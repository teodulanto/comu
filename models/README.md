# Modelos

Los modelos de voz no se guardan en Git.

Comu descarga desde Hugging Face uno de estos modelos compatibles con `whisper.cpp`:

- `ggml-small-q5_1.bin`: perfil Preciso, aproximadamente 190 MB.
- `ggml-base-q5_1.bin`: perfil Rapido, aproximadamente 60 MB.

La aplicacion admite reanudar una descarga parcial, valida el tamano y comprueba el SHA-256 antes de activar el archivo. Los modelos se almacenan en el directorio de datos de Comu, no dentro del repositorio ni de la carpeta de instalacion.
