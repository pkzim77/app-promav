import './Modals.css'
// Modais de criação/edição de atividades, projetos, mudanças e conta, mais o
// diálogo de confirmação. Cada grupo vive no próprio arquivo nesta pasta;
// o que é usado por mais de um grupo (validação de datas, campo de dinheiro)
// fica em shared/.

export { TaskModal } from './TaskModal.jsx'
export { DocumentModal, LinkModal, ImageModal, KmzModal } from './ResourceModals.jsx'
// KmzViewerModal fica FORA deste índice de propósito: ele é importado sob
// demanda (React.lazy) na Ficha técnica. Reexportar aqui o tornaria alcançável
// estaticamente e jogaria o Leaflet de volta no bundle principal.
// PeopleModal, PersonCard e ChangeModal ficam fora pelo mesmo motivo: são
// carregados sob demanda em App.jsx, e reexportar aqui convida a reimportar
// pelo barril e desfazer isso sem ninguém notar.
export { ProjectModal } from './ProjectModal.jsx'
export { StageItemModal } from './StageItemModal.jsx'
export { StageActivitiesModal } from './StageActivitiesModal.jsx'
export { ProjectSearchModal } from './ProjectSearchModal.jsx'
export { MySectorModal, ChangePasswordModal } from './AccountModals.jsx'
export { ConfirmDialog } from './ConfirmDialog.jsx'
