import './Modals.css'
// Modais de criação/edição de atividades, projetos, mudanças e conta, mais o
// diálogo de confirmação. Cada grupo vive no próprio arquivo nesta pasta;
// o que é usado por mais de um grupo (validação de datas, campo de dinheiro)
// fica em shared/.

export { TaskModal } from './TaskModal.jsx'
export { DocumentModal, LinkModal, ImageModal } from './ResourceModals.jsx'
export { ProjectModal } from './ProjectModal.jsx'
export { PeopleModal } from './PeopleModal.jsx'
export { StageItemModal } from './StageItemModal.jsx'
export { ChangeModal } from './ChangeModal.jsx'
export { MySectorModal, ChangePasswordModal } from './AccountModals.jsx'
export { ConfirmDialog } from './ConfirmDialog.jsx'
