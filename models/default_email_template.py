# -*- coding: utf-8 -*-

from openerp import models, fields, api, exceptions
import logging
from openerp.addons.mail.models.mail_thread import MailThread

logger = logging.getLogger(__name__)

class default_email_template(models.Model):
    _name = 'default.email.template'
    
    ir_model_id = fields.Many2one(comodel_name='ir.model', string='Model', domain=lambda self: self.get_model_domain())
    mail_template_id = fields.Many2one(comodel_name='mail.template', string='Mail Template',)
    
    @api.multi
    def get_model_domain(self):
        __models = set()
        for cls in self.env.registry.models:
            if MailThread in self.env[cls].__class__.__bases__:
                __models.add(cls)
        return [('model', 'in', list(__models))]
        
    @api.onchange('ir_model_id')
    def onchange_model(self):
        if self.ir_model_id:
            models = self.get_model_domain()[0][2]
            return {'domain':{'mail_template_id':[('model_id', '=', self.ir_model_id.id)], }}
    
    @api.one
    @api.constrains('ir_model_id')
    def unique_model(self):
        if self.search_count([('ir_model_id', '=', self.ir_model_id.id)]) > 1:
            raise exceptions.ValidationError(u'Email template has already been defined for the template {}'.format(self.ir_model_id.name))