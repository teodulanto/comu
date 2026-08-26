# Fase 0: prueba técnica

> Documento historico. Esta fase ya fue completada y no describe la arquitectura actual de Comu.

## Pregunta que responde

¿Podemos grabar voz y obtener una transcripción local en el equipo sin depender de una API de pago?

## Qué se valida

1. El navegador puede acceder al micrófono.
2. El audio grabado se puede convertir a PCM mono de 16 kHz.
3. Un modelo Whisper pequeño puede ejecutarse localmente.
4. La interfaz puede distinguir entre grabar, procesar, listo y error.
5. El resultado puede copiarse para inspección manual.

## Qué no se valida todavía

- Atajo global fuera de la ventana.
- Inserción en Word, navegador o mensajería.
- Rendimiento de un instalador Tauri.
- Modelos medianos o grandes.
- Corrección avanzada.
- Compatibilidad con macOS o Linux.

## Criterio de éxito

Con Chrome o Edge en Windows, una persona debe poder abrir la aplicación, preparar el modelo, grabar una frase en español y ver un texto razonable sin que el audio sea enviado a un servicio de transcripción.
