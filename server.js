require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } = require('docx');
const multer = require('multer'); // NOVA IMPORTAÇÃO

const app = express();
app.use(express.json());
// CORS liberado para qualquer origem (facilita o teste)
app.use(cors({ origin: '*' }));

// CONEXÃO COM O BANCO (SUPABASE)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// CONFIGURAÇÃO DE UPLOAD (MULTER)
// Isso permite receber arquivos na memória temporária antes de enviar pro Supabase
const upload = multer({ storage: multer.memoryStorage() });

// ROTA DE TESTE
app.get('/', (req, res) => {
  res.send('Servidor de Arquivo Funcionando! 🚀');
});

// --- MÓDULO 1: PLANILHAS (INVENTÁRIO) ---

app.get('/planilhas', async (req, res) => {
  const { data, error } = await supabase
    .from('document_batches')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/planilhas', async (req, res) => {
  const { title, type, file_url } = req.body;
  const { data, error } = await supabase
    .from('document_batches')
    .insert([{ title, type, file_url }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// --- NOVO: UPLOAD DE ARQUIVO (VERSÃO) ---
app.post('/planilhas/:id/upload', upload.single('arquivo'), async (req, res) => {
    try {
        const batchId = req.params.id;
        const file = req.file; 

        if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

        // 1. Descobrir próxima versão
        const { data: existingVersions } = await supabase
            .from('batch_versions')
            .select('version_number')
            .eq('batch_id', batchId)
            .order('version_number', { ascending: false })
            .limit(1);

        const nextVersion = (existingVersions && existingVersions.length > 0) 
            ? existingVersions[0].version_number + 1 
            : 1;

        // 2. Definir nome e caminho
        // Remove caracteres especiais para evitar erro
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        const filePath = `${batchId}/v${nextVersion}_${cleanName}`;

        // 3. Enviar para o Supabase Storage
        const { error: uploadError } = await supabase
            .storage
            .from('arquivos')
            .upload(filePath, file.buffer, {
                contentType: file.mimetype
            });

        if (uploadError) throw uploadError;

        // 4. Salvar registro na tabela
        const { data, error: dbError } = await supabase
            .from('batch_versions')
            .insert([{
                batch_id: batchId,
                version_number: nextVersion,
                file_path: filePath,
                file_name: file.originalname
            }])
            .select();

        if (dbError) throw dbError;

        res.status(201).json(data);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// --- NOVO: LISTAR VERSÕES ---
app.get('/planilhas/:id/versoes', async (req, res) => {
    const { data, error } = await supabase
        .from('batch_versions')
        .select('*')
        .eq('batch_id', req.params.id)
        .order('version_number', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    
    // Gerar link de download para cada versão
    const versionsWithUrl = data.map(v => {
        const { data: publicUrl } = supabase.storage.from('arquivos').getPublicUrl(v.file_path);
        return { ...v, url: publicUrl.publicUrl };
    });

    res.json(versionsWithUrl);
});

// --- MÓDULO 2: PROCESSO DE ELIMINAÇÃO ---

app.get('/processos', async (req, res) => {
  const { data, error } = await supabase
    .from('elimination_processes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/processos', async (req, res) => {
  const { diary_number, total_boxes, description } = req.body;
  const { data, error } = await supabase
    .from('elimination_processes')
    .insert([{ diary_number, total_boxes, description }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

app.post('/processos/:id/log', async (req, res) => {
  const { boxes_eliminated } = req.body;
  const processId = req.params.id;

  const { data: processData } = await supabase
    .from('elimination_processes')
    .select('diary_number')
    .eq('id', processId)
    .single();

  const textoAta = `ATA DE ELIMINAÇÃO - Processo ${processData.diary_number} - Caixas: ${boxes_eliminated}`;

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

// --- AUXILIAR: DATA POR EXTENSO ---
function getDataPorExtenso() {
    const hoje = new Date();
    const dias = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove", "vinte", "vinte e um", "vinte e dois", "vinte e três", "vinte e quatro", "vinte e cinco", "vinte e seis", "vinte e sete", "vinte e oito", "vinte e nove", "trinta", "trinta e um"];
    const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    
    return `Aos ${dias[hoje.getDate()]} dias do mês de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`;
}

// --- GERAR WORD (DOCX) ---
app.post('/processos/:id/ata-word', async (req, res) => {
    try {
        const { boxes_eliminated, diary_number, funcionario, planilha, data_diario, paginas } = req.body;
        const inicioData = getDataPorExtenso();

        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    new Paragraph({
                        alignment: AlignmentType.JUSTIFIED,
                        lineSpacing: 360, 
                        children: [
                            new TextRun({ text: `${inicioData}, nas dependências do Arquivo Central/SEC, iniciamos o processo de eliminação/fragmentação de documentos referentes à planilha de eliminação nº ` }),
                            new TextRun({ text: planilha, bold: true }),
                            new TextRun({ text: `, publicada no Diário do Município, antigo Boletim do Município, nº ${diary_number} de ` }),
                            new TextRun({ text: data_diario }),
                            new TextRun({ text: `, páginas ` }),
                            new TextRun({ text: paginas }),
                            new TextRun({ text: `. A eliminação de documentos foi realizada por ` }),
                            new TextRun({ text: funcionario, bold: true }),
                            new TextRun({ text: `. Foram eliminados os boxes nº: ` }),
                            new TextRun({ text: boxes_eliminated, bold: true }),
                            new TextRun({ text: ` tendo como testemunhas as demais pessoas do setor. Sem mais.` }),
                        ],
                    }),
                    new Paragraph({
                        text: "_______________________________________________",
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 1000 },
                    }),
                    new Paragraph({
                        text: funcionario,
                        alignment: AlignmentType.CENTER,
                    }),
                ],
            }],
        });

        const buffer = await Packer.toBuffer(doc);
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
