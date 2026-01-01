require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } = require('docx');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' })); // Permite conexões de qualquer lugar

// CONEXÃO COM O BANCO (SUPABASE)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Verifica se as chaves existem (Evita crash no Render se esquecer de configurar)
if (!supabaseUrl || !supabaseKey) {
    console.error("ERRO CRÍTICO: SUPABASE_URL ou SUPABASE_KEY não configurados.");
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

// ROTA DE SAÚDE (Para checar se o servidor acordou)
app.get('/', (req, res) => {
  res.send({ status: 'Online', service: 'Hub.Doc API' });
});

// --- ROTAS DE PROCESSOS (FLUXO) ---

// 1. Listar Processos
app.get('/processos', async (req, res) => {
  const { data, error } = await supabase
    .from('processos_eliminacao')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 2. Criar Processo
app.post('/processos', async (req, res) => {
  const { numero_processo, link_planilha, status } = req.body;
  const { data, error } = await supabase
    .from('processos_eliminacao')
    .insert([{ numero_processo, link_planilha, status }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// 3. Atualizar Status
app.put('/processos/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const { data, error } = await supabase
    .from('processos_eliminacao')
    .update({ status })
    .eq('id', id)
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 4. Gerar ATA em Word (.docx)
app.post('/processos/:id/ata-word', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            boxes_eliminated, diary_number, funcionario, 
            planilha, data_diario, paginas 
        } = req.body;

        // Atualiza o banco com o log da eliminação
        await supabase
            .from('processos_eliminacao')
            .update({ 
                funcionario_responsavel: funcionario,
                boxes_eliminados: boxes_eliminated 
            })
            .eq('id', id);

        // Gera o Documento
        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    new Paragraph({
                        text: "ATA DE ELIMINAÇÃO DE DOCUMENTOS",
                        heading: HeadingLevel.TITLE,
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 500 },
                    }),
                    new Paragraph({
                        text: `Aos ${new Date().toLocaleDateString('pt-BR')} foi realizada a eliminação dos documentos previstos na Listagem de Eliminação de Documentos nº ${planilha}, aprovada pelo Chefe do Poder Executivo, conforme edital de Ciência de Eliminação de Documentos nº ${diary_number}, publicado no Diário Oficial de ${data_diario}, páginas ${paginas}.`,
                        alignment: AlignmentType.JUSTIFIED,
                        spacing: { after: 300 },
                    }),
                    new Paragraph({
                        alignment: AlignmentType.JUSTIFIED,
                        children: [
                            new TextRun({ text: `A eliminação dos documentos foi realizada por ` }),
                            new TextRun({ text: funcionario, bold: true }),
                            new TextRun({ text: `. Foram eliminados os boxes nº: ` }),
                            new TextRun({ text: boxes_eliminated, bold: true, color: "FF0000" }),
                            new TextRun({ text: `.` }),
                        ],
                    }),
                    new Paragraph({
                        text: "_______________________________________________",
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 1500 },
                    }),
                    new Paragraph({
                        text: funcionario,
                        alignment: AlignmentType.CENTER,
                        bold: true
                    }),
                    new Paragraph({
                        text: "Responsável pela Eliminação",
                        alignment: AlignmentType.CENTER,
                    }),
                ],
            }],
        });

        const buffer = await Packer.toBuffer(doc);
        res.setHeader('Content-Disposition', `attachment; filename=Ata_Processo_${id}.docx`);
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
