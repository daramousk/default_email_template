odoo.define('default_email_template.ChatThreadExtension', function(require) {
    "use strict";
    var core = require('web.core');
    var Widget = require('web.Widget');
    var Chatter = require('mail.Chatter')
    var Model = require('web.Model')
    var composer = require('mail.composer')
    var config = require('web.config');
    var chat_manager = require('mail.chat_manager');

    var data = require('web.data');
    var Dialog = require('web.Dialog');
    var form_common = require('web.form_common');
    var session = require('web.session');

    var _t = core._t;

    // Note: The ChatterComposer is not exported by the chatter js so we have to
    // redefine it.
    // The implementation below works, but it is not the right one because I
    // have redefined the composer
    // instead of extending it.
    // TODO: Find a way to extend the ChatterComposer without redefining
    // everything ...

    var parse_email = function(text) {
	var result = text.match(/(.*)<(.*@.*)>/);
	if (result) {
	    return [ _.str.trim(result[1]), _.str.trim(result[2]) ];
	}
	result = text.match(/(.*@.*)/);
	if (result) {
	    return [ _.str.trim(result[1]), _.str.trim(result[1]) ];
	}
	return [ text, false ];
    };

    var get_text2html = function(text) {
	return text.replace(/((?:https?|ftp):\/\/[\S]+)/g, '<a href="$1">$1</a> ').replace(/[\n\r]/g, '<br/>');
    };
    var ChatterComposer = composer.BasicComposer.extend({
	template : 'mail.chatter.ChatComposer',

	init : function(parent, dataset, options) {
	    this._super(parent, options);
	    this.thread_dataset = dataset;
	    this.suggested_partners = [];
	    this.options = _.defaults(this.options, {
		display_mode : 'textarea',
		record_name : false,
		is_log : false,
		internal_subtypes : [],
	    });
	    if (this.options.is_log) {
		this.options.send_text = _t('Log');
	    }
	    this.events = _.extend(this.events, {
		'click .o_composer_button_full_composer' : 'on_open_full_composer',
	    });
	},

	willStart : function() {
	    if (this.options.is_log) {
		return this._super.apply(this, arguments);
	    }
	    return $.when(this._super.apply(this, arguments), this.message_get_suggested_recipients());
	},

	should_send : function() {
	    return false;
	},

	preprocess_message : function() {
	    var self = this;
	    var def = $.Deferred();
	    this._super().then(function(message) {
		message = _.extend(message, {
		    subtype_id : false,
		    subtype : 'mail.mt_comment',
		    message_type : 'comment',
		    content_subtype : 'html',
		    context : self.context,
		});

		// Subtype
		if (self.options.is_log) {
		    var subtype_id = parseInt(self.$('.o_chatter_composer_subtype_select').val());
		    if (_.indexOf(_.pluck(self.options.internal_subtypes, 'id'), subtype_id) === -1) {
			message.subtype = 'mail.mt_note';
		    } else {
			message.subtype_id = subtype_id;
		    }
		}

		// Partner_ids
		if (!self.options.is_log) {
		    var checked_suggested_partners = self.get_checked_suggested_partners();
		    self.check_suggested_partners(checked_suggested_partners).done(function(partner_ids) {
			message.partner_ids = (message.partner_ids || []).concat(partner_ids);
			// update context
			message.context = _.defaults({}, message.context, {
			    mail_post_autofollow : true,
			});
			def.resolve(message);
		    });
		} else {
		    def.resolve(message);
		}

	    });

	    return def;
	},

	/**
	 * Send the message on SHIFT+ENTER, but go to new line on ENTER
	 */
	prevent_send : function(event) {
	    return !event.shiftKey;
	},

	message_get_suggested_recipients : function() {
	    var self = this;
	    var email_addresses = _.pluck(this.suggested_partners, 'email_address');
	    return this.thread_dataset.call('message_get_suggested_recipients', [ [ this.context.default_res_id ], this.context ]).done(function(suggested_recipients) {
		var thread_recipients = suggested_recipients[self.context.default_res_id];
		_.each(thread_recipients, function(recipient) {
		    var parsed_email = parse_email(recipient[1]);
		    if (_.indexOf(email_addresses, parsed_email[1]) === -1) {
			self.suggested_partners.push({
			    checked : true,
			    partner_id : recipient[0],
			    full_name : recipient[1],
			    name : parsed_email[0],
			    email_address : parsed_email[1],
			    reason : recipient[2],
			});
		    }
		});
	    });
	},

	/**
	 * Get the list of selected suggested partners
	 * 
	 * @returns Array() : list of 'recipient' selected partners (may not be
	 *          created in db)
	 */
	get_checked_suggested_partners : function() {
	    var self = this;
	    var checked_partners = [];
	    this.$('.o_composer_suggested_partners input:checked').each(function() {
		var full_name = $(this).data('fullname');
		checked_partners = checked_partners.concat(_.filter(self.suggested_partners, function(item) {
		    return full_name === item.full_name;
		}));
	    });
	    return checked_partners;
	},

	/**
	 * Check the additionnal partners (not necessary registered partners),
	 * and open a popup form view for the ones who informations is missing.
	 * 
	 * @param Array :
	 *                list of 'recipient' partners to complete informations
	 *                or validate
	 * @returns Deferred resolved with the list of checked suggested
	 *          partners (real partner)
	 */
	check_suggested_partners : function(checked_suggested_partners) {
	    var self = this;
	    var check_done = $.Deferred();

	    var recipients = _.filter(checked_suggested_partners, function(recipient) {
		return recipient.checked;
	    });
	    var recipients_to_find = _.filter(recipients, function(recipient) {
		return (!recipient.partner_id);
	    });
	    var names_to_find = _.pluck(recipients_to_find, 'full_name');
	    var recipients_to_check = _.filter(recipients, function(recipient) {
		return (recipient.partner_id && !recipient.email_address);
	    });
	    var recipient_ids = _.pluck(_.filter(recipients, function(recipient) {
		return recipient.partner_id && recipient.email_address;
	    }), 'partner_id');

	    var names_to_remove = [];
	    var recipient_ids_to_remove = [];

	    // have unknown names -> call
	    // message_get_partner_info_from_emails to try to find
	    // partner_id
	    var find_done = $.Deferred();
	    if (names_to_find.length > 0) {
		find_done = self.thread_dataset.call('message_partner_info_from_emails', [ [ this.context.default_res_id ], names_to_find ]);
	    } else {
		find_done.resolve([]);
	    }

	    // for unknown names + incomplete partners -> open popup -
	    // cancel = remove from recipients
	    $.when(find_done).pipe(function(result) {
		var emails_deferred = [];
		var recipient_popups = result.concat(recipients_to_check);

		_.each(recipient_popups, function(partner_info) {
		    var deferred = $.Deferred();
		    emails_deferred.push(deferred);

		    var partner_name = partner_info.full_name;
		    var partner_id = partner_info.partner_id;
		    var parsed_email = parse_email(partner_name);

		    var dialog = new form_common.FormViewDialog(self, {
			res_model : 'res.partner',
			res_id : partner_id,
			context : {
			    force_email : true,
			    ref : "compound_context",
			    default_name : parsed_email[0],
			    default_email : parsed_email[1],
			},
			title : _t("Please complete partner's informations"),
			disable_multiple_selection : true,
		    }).open();
		    dialog.on('closed', self, function() {
			deferred.resolve();
		    });
		    dialog.view_form.on('on_button_cancel', self, function() {
			names_to_remove.push(partner_name);
			if (partner_id) {
			    recipient_ids_to_remove.push(partner_id);
			}
		    });
		});
		$.when.apply($, emails_deferred).then(function() {
		    var new_names_to_find = _.difference(names_to_find, names_to_remove);
		    find_done = $.Deferred();
		    if (new_names_to_find.length > 0) {
			find_done = self.thread_dataset.call('message_partner_info_from_emails', [ [ self.context.default_res_id ], new_names_to_find, true ]);
		    } else {
			find_done.resolve([]);
		    }
		    $.when(find_done).pipe(function(result) {
			var recipient_popups = result.concat(recipients_to_check);
			_.each(recipient_popups, function(partner_info) {
			    if (partner_info.partner_id && _.indexOf(partner_info.partner_id, recipient_ids_to_remove) === -1) {
				recipient_ids.push(partner_info.partner_id);
			    }
			});
		    }).pipe(function() {
			check_done.resolve(recipient_ids);
		    });
		});
	    });
	    return check_done;
	},

	on_open_full_composer : function() {
	    if (!this.do_check_attachment_upload()) {
		return false;
	    }

	    var self = this;
	    var recipient_done = $.Deferred();
	    if (this.options.is_log) {
		recipient_done.resolve([]);
	    } else {
		var checked_suggested_partners = this.get_checked_suggested_partners();
		recipient_done = this.check_suggested_partners(checked_suggested_partners);
	    }
	    recipient_done.then(function(partner_ids) {
		var context = {
		    default_parent_id : self.id,
		    default_body : get_text2html(self.$input.val()),
		    default_attachment_ids : _.pluck(self.get('attachment_ids'), 'id'),
		    default_partner_ids : partner_ids,
		    default_is_log : self.options.is_log,
		    mail_post_autofollow : true,
		};

		if (self.context.default_model && self.context.default_res_id) {
		    context.default_model = self.context.default_model;
		    context.default_res_id = self.context.default_res_id;
		}
		new Model('default.email.template').query([ 'mail_template_id', ]).filter([ [ 'ir_model_id', '=', self.context['default_model'] ] ]).all().then(function(result) {
		    console.log('Result')
		    console.log(result)
		    if (result.length == 1){
			context['default_template_id'] = result[0]['mail_template_id'][0]
		    }
		    self.do_action({
			type : 'ir.actions.act_window',
			res_model : 'mail.compose.message',
			view_mode : 'form',
			view_type : 'form',
			views : [ [ false, 'form' ] ],
			target : 'new',
			context : context,
		    }, {
			on_close : function() {
			    self.trigger('need_refresh');
			    var parent = self.getParent();
			    chat_manager.get_messages({
				model : parent.model,
				res_id : parent.res_id
			    });
			},
		    }).then(self.trigger.bind(self, 'close_composer'));
		})

	    });
	}
    });
    var ChatterExtension = Chatter.include({

	open_composer : function(options) {
	    self = this
	    var old_composer = this.composer;
	    // create the new composer
	    this.composer = new ChatterComposer(this, this.thread_dataset, {
		context : this.context,
		input_min_height : 50,
		input_max_height : Number.MAX_VALUE,
		input_baseline : 14,
		internal_subtypes : this.options.internal_subtypes,
		is_log : options && options.is_log,
		record_name : this.record_name,
		default_body : old_composer && old_composer.$input && old_composer.$input.val(),
		default_mention_selections : old_composer && old_composer.mention_get_listener_selections(),
	    });
	    this.composer.on('input_focused', this, function() {
		this.composer.mention_set_prefetched_partners(this.mention_suggestions || []);
	    });
	    this.composer.insertBefore(this.$('.o_mail_thread')).then(function() {
		// destroy existing composer
		if (old_composer) {
		    old_composer.destroy();
		}
		if (!config.device.touch) {
		    self.composer.focus();
		}
		self.composer.on('post_message', self, self.on_post_message);
		self.composer.on('need_refresh', self, self.refresh_followers);
		self.composer.on('close_composer', null, self.close_composer.bind(self, true));
	    });
	    this.mute_new_message_button(true);

	}

    })
    return ChatterExtension

})