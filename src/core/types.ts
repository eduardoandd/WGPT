export interface MessageAttachment {
  type: 'pdf' | 'spreadsheet'
  buffer: Buffer
  fileName: string
  mimeType: string
}

export interface IncomingMessage {
  /** ID único da sessão — usado como thread_id no LangGraph (ex: número de telefone) */
  sessionId: string
  /** Canal de destino para a resposta (ex: chatId do WhatsApp, "cli", canal do Telegram) */
  chatId: string
  text?: string
  attachment?: MessageAttachment
}

export interface ClientAdapter {
  /** Inicia o adapter e registra o handler de mensagens */
  start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void>
  /** Envia uma mensagem de texto para o canal de origem */
  sendText(chatId: string, text: string): Promise<void>
  /** Envia um arquivo (ex: PDF gerado) para o canal de origem */
  sendFile(chatId: string, filePath: string, fileName: string): Promise<void>
  /** Opcional: indica que o bot está digitando */
  setTyping?(chatId: string): Promise<void>
}
