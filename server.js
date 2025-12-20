// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } = require('docx');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

// CONEXÃO COM O BANCO (SUPABASE)
// O Render vai ler essas variáveis das configurações que faremos lá
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ROTA DE TESTE (Para saber se o servidor está vivo)
app.get('/', (req, res) => {
  res.send('Servidor de Arquivo Funcionando! 🚀');
});

// --- MÓDULO 1: PLANILHAS (INVENTÁRIO) ---

// Listar todas as planilhas
app.get('/planilhas', async (req, res) => {
  const { data, error } = await supabase
    .from('document_batches')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Criar nova planilha
app.post('/planilhas', async (req, res) => {
  const { title, type, file_url } = req.body;
  
  const { data, error } = await supabase
    .from('document_batches')
    .insert([{ title, type, file_url }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// --- MÓDULO 2: PROCESSO DE ELIMINAÇÃO ---

// Iniciar um novo processo (Lote de caixas)
app.post('/processos', async (req, res) => {
  const { diary_number, total_boxes, description } = req.body;

  const { data, error } = await supabase
    .from('elimination_processes')
    .insert([{ diary_number, total_boxes, description }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Registrar dia de eliminação (Gerar Ata simplificada)
app.post('/processos/:id/log', async (req, res) => {
  const { boxes_eliminated } = req.body; // Ex: "10, 11, 12"
  const processId = req.params.id;

  // 1. Busca dados do processo para compor a ata
  const { data: processData } = await supabase
    .from('elimination_processes')
    .select('diary_number')
    .eq('id', processId)
    .single();

  // 2. Gera o texto da ata (Simples por enquanto)
  const textoAta = `ATA DE ELIMINAÇÃO\nData: ${new Date().toLocaleDateString()}\nProcesso Diário: ${processData.diary_number}\nCaixas Eliminadas: ${boxes_eliminated}`;

  // 3. Salva no banco
  const { data, error } = await supabase
    .from('elimination_logs')
    .insert([{ 
      process_id: processId, 
      boxes_eliminated, 
      ata_content: textoAta 
    }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Listar processos de eliminação
app.get('/processos', async (req, res) => {
  const { data, error } = await supabase
    .from('elimination_processes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ROTA PARA GERAR O WORD (DOCX)
app.post('/processos/:id/ata-word', async (req, res) => {
    try {
        const { boxes_eliminated, diary_number } = req.body;

        // 1. Criação do Documento
        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    // Título
                    new Paragraph({
                        text: "ATA DE ELIMINAÇÃO DE DOCUMENTOS",
                        heading: HeadingLevel.HEADING_1,
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 300 },
                    }),
                    
                    // Data e Processo
                    new Paragraph({
                        children: [
                            new TextRun({ text: "Data de Emissão: ", bold: true }),
                            new TextRun({ text: new Date().toLocaleDateString() }),
                        ],
                        spacing: { after: 100 },
                    }),
                    new Paragraph({
                        children: [
                            new TextRun({ text: "Diário Oficial / Processo: ", bold: true }),
                            new TextRun({ text: diary_number }),
                        ],
                        spacing: { after: 300 },
                    }),

                    // Texto legal
                    new Paragraph({
                        text: "Certificamos para os devidos fins que foram eliminadas, conforme procedimentos legais de gestão documental, as caixas/boxes listadas abaixo:",
                        alignment: AlignmentType.JUSTIFIED,
                        spacing: { after: 200 },
                    }),

                    // A Lista de Caixas (Destaque)
                    new Paragraph({
                        text: boxes_eliminated,
                        bold: true,
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 200, after: 400 },
                    }),

                    // Assinatura
                    new Paragraph({
                        text: "_______________________________________________",
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 800 },
                    }),
                    new Paragraph({
                        text: "Responsável pela Eliminação",
                        alignment: AlignmentType.CENTER,
                    }),
                ],
            }],
        });

        // 2. Gerar o Buffer (o arquivo na memória)
        const buffer = await Packer.toBuffer(doc);

        // 3. Enviar para o navegador baixar
        res.setHeader('Content-Disposition', 'attachment; filename=Ata_Eliminacao.docx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.send(buffer);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao gerar documento Word" });
    }
});

// INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);

});


