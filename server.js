require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } = require('docx');
const multer = require('multer');

const app = express();
app.use(express.json());

// Permite conexões de qualquer lugar (necessário para o Frontend acessar a API)
app.use(cors({ origin: '*' }));

// --- CONFIGURAÇÕES ---

// Conexão com Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Configuração do Multer (Upload de arquivos na memória RAM temporária)
const upload = multer({ storage: multer.memoryStorage() });

// Rota de Teste (Ping)
app.get('/', (req, res) => {
  res.send('Servidor do Arquivo Central Online! 🚀');
});


// ============================================================
// MÓDULO 1: PLANILHAS (REPOSITÓRIO & CORREÇÃO)
// ============================================================

// 1. Listar todas as planilhas
app.get('/planilhas', async (req, res) => {
  const { data, error } = await supabase
    .from('document_batches')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 2. Criar nova planilha
app.post('/planilhas', async (req, res) => {
  const { title, type } = req.body;
  
  // Define status inicial como 'rascunho' se não vier nada
  const statusInicial = 'rascunho';

  const { data, error } = await supabase
    .from('document_batches')
    .insert([{ title, type, status: statusInicial }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// 3. Alterar Status (Para enviar p/ Correção ou Finalizar)
app.patch('/planilhas/:id/status', async (req, res) => {
    const { status } = req.body;
    const { id } = req.params;

    const { data, error } = await supabase
        .from('document_batches')
        .update({ status: status })
        .eq('id', id)
        .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// 4. Upload de Arquivo (Com Versionamento V1, V2...)
app.post('/planilhas/:id/upload', upload.single('arquivo'), async (req, res) => {
    try {
        const batchId = req.params.id;
        const file = req.file; 

        if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

        // A. Descobrir qual é a próxima versão
        const { data: existingVersions } = await supabase
            .from('batch_versions')
            .select('version_number')
            .eq('batch_id', batchId)
            .order('version_number', { ascending: false })
            .limit(1);

        const nextVersion = (existingVersions && existingVersions.length > 0) 
            ? existingVersions[0].version_number + 1 
            : 1;

        // B. Higienizar nome do arquivo e definir caminho
        // Ex: "Relatório Final.docx" vira "Relatorio_Final.docx"
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        const filePath = `${batchId}/v${nextVersion}_${cleanName}`;

        // C. Enviar para o Supabase Storage (Bucket 'arquivos')
        const { error: uploadError } = await supabase
            .storage
            .from('arquivos')
            .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: true
            });

        if (uploadError) throw uploadError;

        // D. Salvar registro na tabela de versões (Banco de Dados)
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

// 5. Listar Versões de uma Planilha (Para Download)
app.get('/planilhas/:id/versoes', async (req, res) => {
    const { data, error } = await supabase
        .from('batch_versions')
        .select('*')
        .eq('batch_id', req.params.id)
        .order('version_number', { ascending: false }); // Do mais novo pro mais velho

    if (error) return res.status(500).json({ error: error.message });
    
    // Gera URL pública assinada para cada arquivo
    const versionsWithUrl = data.map(v => {
        const { data: publicUrl } = supabase.storage.from('arquivos').getPublicUrl(v.file_path);
        return { ...v, url: publicUrl.publicUrl };
    });

    res.json(versionsWithUrl);
});


// ============================================================
// MÓDULO 2: PROCESSOS DE ELIMINAÇÃO (ATAS)
// ============================================================

// 6. Listar Processos
app.get('/processos', async (req, res) => {
  const { data, error } = await supabase
    .from('elimination_processes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 7. Criar Processo
app.post('/processos', async (req, res) => {
  const { diary_number, total_boxes, description } = req.body;

  const { data, error } = await supabase
    .from('elimination_processes')
    .insert([{ diary_number, total_boxes, description }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// 8. Salvar Log (Histórico do que foi eliminado no dia)
app.post('/processos/:id/log', async (req, res) => {
  const { boxes_eliminated } = req.body;
  const processId = req.params.id;

  // Busca info do processo só para compor o texto do log se precisar
  const { data: processData } = await supabase
    .from('elimination_processes')
    .select('diary_number')
    .eq('id', processId)
    .single();

  const textoLog = `Eliminação Diária - Processo ${processData.diary_number}`;

  const { data, error } = await supabase
    .from('elimination_logs')
    .insert([{ 
      process_id: processId, 
      boxes_eliminated, 
      ata_content: textoLog 
    }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// --- FUNÇÃO AUXILIAR: DATA POR EXTENSO ---
function getDataPorExtenso() {
    const hoje = new Date();
    const dias = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove", "vinte", "vinte e um", "vinte e dois", "vinte e três", "vinte e quatro", "vinte e cinco", "vinte e seis", "vinte e sete", "vinte e oito", "vinte e nove", "trinta", "trinta e um"];
    const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    
    // Ajuste simples para dia (pega o dia do mês)
    const diaNum = hoje.getDate();
    const diaExtenso = dias[diaNum] || diaNum; // Fallback se passar de 31
    const mes = meses[hoje.getMonth()];
    const ano = hoje.getFullYear();
    
    return `Aos ${diaExtenso} dias do mês de ${mes} de ${ano}`;
}

// 9. GERAR ARQUIVO WORD (.DOCX) - ATA OFICIAL
app.post('/processos/:id/ata-word', async (req, res) => {
    try {
        const { boxes_eliminated, diary_number, funcionario, planilha, data_diario, paginas } = req.body;
        
        // Data formatada para o texto jurídico
        const inicioData = getDataPorExtenso();

        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    // TÍTULO
                    new Paragraph({
                        text: "ATA DE ELIMINAÇÃO DE DOCUMENTOS",
                        heading: HeadingLevel.HEADING_1,
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 400 },
                    }),

                    // TEXTO CORRIDO (JURÍDICO)
                    new Paragraph({
                        alignment: AlignmentType.JUSTIFIED,
                        lineSpacing: 360, // Espaçamento 1.5
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

                    // ASSINATURA
                    new Paragraph({
                        text: "_______________________________________________",
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 1000 },
                    }),
                    new Paragraph({
                        text: funcionario,
                        alignment: AlignmentType.CENTER,
                        bold: true,
                    }),
                    new Paragraph({
                        text: "Responsável pela Eliminação",
                        alignment: AlignmentType.CENTER,
                    }),
                ],
            }],
        });

        // Gera o arquivo na memória
        const buffer = await Packer.toBuffer(doc);

        // Define os cabeçalhos para o navegador entender que é um download
        res.setHeader('Content-Disposition', 'attachment; filename=Ata_Eliminacao.docx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.send(buffer);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao gerar documento Word" });
    }
});

// ============================================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
