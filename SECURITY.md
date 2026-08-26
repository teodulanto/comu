# Seguridad

## Versiones soportadas

Comu esta en una etapa temprana. Solo la version publicada mas reciente recibe correcciones de seguridad.

## Privacidad y red

- El audio se procesa localmente con `whisper.cpp`.
- No hay cuentas, telemetria ni un servidor de transcripcion.
- La aplicacion se conecta a Hugging Face para descargar los modelos GGML.
- Las descargas se validan por tamano y SHA-256 antes de activarse.
- El script de desarrollo descarga un release concreto de `whisper.cpp` y tambien verifica su SHA-256.

Los trabajos se guardan en el directorio de datos de la aplicacion. Un WAV se elimina despues de una transcripcion correcta y se conserva cuando ocurre un error recuperable. Quien comparta registros de diagnostico debe comprobar que no incluyan voz, transcripciones ni datos personales.

## Limites de la insercion de texto

Comu utiliza el portapapeles y eventos de teclado de Windows. No debe ejecutarse con privilegios de administrador salvo que sea estrictamente necesario. Windows puede impedir la insercion en aplicaciones que tengan un nivel de privilegios superior.

## Reportar una vulnerabilidad

No publiques vulnerabilidades, grabaciones, credenciales ni datos personales en un issue publico. Usa la opcion **Report a vulnerability** de GitHub Security Advisories en este repositorio. Incluye:

- version de Comu y version de Windows;
- descripcion del impacto;
- pasos minimos para reproducir;
- archivos afectados o propuesta de correccion, si existe.

Se acusara recibo tan pronto como sea posible. La divulgacion publica debe esperar a que exista una correccion o una mitigacion acordada.
