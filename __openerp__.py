# -*- coding: utf-8 -*-
{
    'name': "Default Email Template",

    'summary': """
        Set a default email template for each model.""",

    'description': """
        What this module basically does is allowing you to set up a default template to be set when the Email Composer pops up
        from the bottom of every form page. Go to Settings -> Technical -> Default Email Templates and set up a default template
        to be set for each model. So - for example - when you go to Sales -> Sale Orders and send a message on the buttom,
        when the popup opens up the default template will be set.
    """,

    'author': "George Daramouskas",
    'website': "https://www.linkedin.com/in/georgedaramouskas",

    # Categories can be used to filter modules in modules listing
    # Check https://github.com/odoo/odoo/blob/master/openerp/addons/base/module/module_data.xml
    # for the full list
    'category': 'Technical Settings',
    'version': '0.1',

    # any module necessary for this one to work correctly
    'depends': ['base', 'mail', ],

    # always loaded
    'data': [
        # 'security/ir.model.access.csv',
        'views/views.xml',
        'data/assets.xml',
    ],
    'application':True
}
